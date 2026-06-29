document.getElementById('pushForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const numbers = document.getElementById('numbers').value;
    const amount = document.getElementById('amount').value;
    const reference = document.getElementById('reference').value;

    submitBtn.disabled = true;
    document.getElementById('idleState').classList.add('hidden');
    document.getElementById('progressContainer').classList.remove('hidden');

    try {
        const response = await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, amount, reference })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Server processing error');

        // Poll for updates every 1.5 seconds
        const pollInterval = setInterval(async () => {
            const statusRes = await fetch(`/api/job/${data.jobId}`);
            const job = await statusRes.json();

            const percentage = Math.round((job.processed / job.total) * 100);
            
            const progressBar = document.getElementById('progressBar');
            progressBar.style.width = `${percentage}%`;
            progressBar.innerText = `${percentage}%`;

            document.getElementById('statProcessed').innerText = `Processed: ${job.processed}/${job.total}`;
            document.getElementById('statSuccess').innerText = `Success: ${job.successCount}`;
            document.getElementById('statFailure').innerText = `Failed: ${job.failureCount}`;

            // Render log outputs sequentially
            const logStream = document.getElementById('logStream');
            logStream.innerHTML = job.results.map(res => `
                <div class="log-line">
                    [${res.status}] <span class="${res.status === 'Success' ? 'txt-success' : 'txt-danger'}">${res.msisdn}</span> - ${res.details}
                </div>
            `).join('');

            if (job.status === 'completed') {
                clearInterval(pollInterval);
                submitBtn.disabled = false;
                document.getElementById('idleState').innerText = "Bulk job run complete.";
                document.getElementById('idleState').classList.remove('hidden');
            }
        }, 1500);

    } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
    }
});
