PlatformAuth.requireAuth();

async function load() {
    try {
        const res = await PlatformAuth.authFetch('/api/platform/settings');
        if (!res.ok) throw new Error('Request failed');
        const data = await res.json();

        document.getElementById('platformVersion').textContent = data.platformVersion;
        document.getElementById('databaseVersion').textContent = data.databaseVersion;
        document.getElementById('environment').textContent = data.environment;
        document.getElementById('totalStorageUsed').textContent = data.totalStorageUsed;
        document.getElementById('totalHospitals').textContent = data.totalHospitals;
        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('futureBillingStatus').textContent = data.futureBillingStatus;

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('settingsContent').style.display = 'block';
    } catch (err) {
        console.error('Failed to load platform settings:', err);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorState').textContent = 'Could not reach the server.';
    }
}

load();
