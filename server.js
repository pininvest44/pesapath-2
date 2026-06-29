const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory application state
const activeJobs = new Map();
const globalLogs = [];

/**
 * Normalizes Kenyan phone numbers to 254XXXXXXXXX format
 */
function normalizePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, ''); // Strip non-numeric characters
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.slice(1);
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
        cleaned = '254' + cleaned;
    }
    return cleaned.length === 12 && (cleaned.startsWith('2547') || cleaned.startsWith('2541')) ? cleaned : null;
}

// Serve UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Trigger Bulk Job
app.post('/api/push', (req, res) => {
    const { numbers, amount, reference } = req.body;
    const apiKey = process.env.FINASWIFT_API_KEY;
    const email = process.env.FINASWIFT_EMAIL;

    if (!apiKey || !email) {
        return res.status(500).json({ error: 'Server configuration missing API key or Email.' });
    }

    if (!numbers || !amount || !reference) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    // Split and filter numbers
    const rawList = numbers.split(/[\n,]+/).map(n => n.trim()).filter(n => n.length > 0);
    const queue = [];
    const invalid = [];

    rawList.forEach(num => {
        const validNum = normalizePhoneNumber(num);
        if (validNum) {
            queue.push(validNum);
        } else {
            invalid.push(num);
        }
    });

    if (queue.length === 0) {
        return res.status(400).json({ error: 'No valid Kenyan phone numbers provided.' });
    }

    const jobId = 'job_' + Date.now();
    const jobStatus = {
        id: jobId,
        total: queue.length,
        processed: 0,
        successCount: 0,
        failureCount: 0,
        status: 'processing',
        invalidList: invalid,
        results: []
    };

    activeJobs.set(jobId, jobStatus);

    // Start background queue processing asynchronously
    processQueue(jobId, queue, parseFloat(amount), reference, apiKey, email);

    // Return receipt immediately so the client context doesn't timeout
    res.json({ jobId, total: queue.length, invalidCount: invalid.length });
});

// Get Live Status Update
app.get('/api/job/:id', (req, res) => {
    const job = activeJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job identifier not found.' });
    res.json(job);
});

// Fetch historical audit logs
app.get('/api/logs', (req, res) => {
    res.json(globalLogs);
});

/**
 * Sequentially loops through numbers adhering to the 30 requests/min rule
 */
async function processQueue(jobId, queue, amount, reference, apiKey, email) {
    const job = activeJobs.get(jobId);
    
    for (let i = 0; i < queue.length; i++) {
        const msisdn = queue[i];
        const timestamp = new Date().toLocaleTimeString();

        try {
            const response = await fetch('https://api.pesapath.com/v1/stkpush', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, email, amount, msisdn, reference })
            });

            const data = await response.json();

            // Treat as success if API returns a healthy response status
            if (response.ok) {
                job.successCount++;
                job.results.push({ msisdn, status: 'Success', details: data.message || 'STK Push Triggered' });
                globalLogs.unshift({ timestamp, msisdn, status: 'SUCCESS', reference });
            } else {
                throw new Error(data.message || `API Error Status: ${response.status}`);
            }
        } catch (error) {
            job.failureCount++;
            job.results.push({ msisdn, status: 'Failed', details: error.message });
            globalLogs.unshift({ timestamp, msisdn, status: 'FAILED', reason: error.message });
        }

        job.processed++;
        
        // 30 requests per minute = 1 request every 2 seconds (2000ms delay)
        if (i < queue.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    job.status = 'completed';
}

app.listen(PORT, () => console.log(`Application running on port ${PORT}`));
