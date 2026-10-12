// ==========================================
// 1. INITIALIZATION & STATE MANAGEMENT
// ==========================================
let streamInterval = null;
let packetCount = 0;
let telemetryHistory = [];

const startingLat = 28.6139; 
const startingLng = 77.2090;

// Initialize Leaflet Map
const map = L.map('map').setView([startingLat, startingLng], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let droneMarker = L.marker([startingLat, startingLng]).addTo(map).bindPopup("CanSat Payload Location");
let pathHistory = L.polyline([], {color: '#38bdf8', weight: 4}).addTo(map);

// Initialize Chart.js with White Labels and Legends
const ctx = document.getElementById('telemetryChart').getContext('2d');
const telemetryChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            { label: 'Altitude (m)', data: [], borderColor: '#38bdf8', tension: 0.1, yAxisID: 'y', pointStyle: 'line', borderWidth: 3 },
            { label: 'Temp (°C)', data: [], borderColor: '#ef4444', tension: 0.1, yAxisID: 'y1', pointStyle: 'line', borderWidth: 3 }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#ffffff',
                    usePointStyle: true 
                }
            }
        },
        scales: {
            x: {
                ticks: {
                    color: '#ffffff' // White text for packet intervals
                },
                grid: {
                    color: '#1f2937' // Subtle dark grid lines
                }
            },
            y: { 
                type: 'linear', 
                display: true, 
                position: 'left',
                min: 0,      // Forces the baseline to stay at ground level (0m)
                max: 550,    // Locks the ceiling just above maximum drop altitude (500m)
                ticks: {
                    color: '#ffffff' 
                },
                grid: { 
                    color: '#1f2937' 
                } 
            },
            y1: { 
                type: 'linear', 
                display: true, 
                position: 'right',
                min: 0,      // Prevents temperature lines from warping wildly
                max: 50,     // Sets a realistic upper limit for environment temps
                ticks: {
                    color: '#ffffff' 
                },
                grid: { 
                    drawOnChartArea: false // Prevents secondary lines from cluttering the grid
                } 
            }
        }
    }
});

// Initialize Horizon Canvas Context
const horizonCanvas = document.getElementById('horizonCanvas');
const hCtx = horizonCanvas.getContext('2d');

// ==========================================
// 2. ARTIFICIAL HORIZON RENDERER (Section 8)
// ==========================================
function drawArtificialHorizon(rollDegree, pitchDegree) {
    const cx = horizonCanvas.width / 2;
    const cy = horizonCanvas.height / 2;
    const r = horizonCanvas.width / 2;

    hCtx.clearRect(0, 0, horizonCanvas.width, horizonCanvas.height);

    hCtx.save();
    hCtx.translate(cx, cy);
    hCtx.rotate(-rollDegree * Math.PI / 180);
    
    const pitchOffset = pitchDegree * 2.5;

    // Sky
    hCtx.fillStyle = "#1d4ed8";
    hCtx.beginPath();
    hCtx.arc(0, 0, r, 0, 2 * Math.PI);
    hCtx.fill();

    // Earth
    hCtx.fillStyle = "#78350f";
    hCtx.beginPath();
    hCtx.rect(-r, pitchOffset, r * 2, r * 2);
    hCtx.fill();

    // Horizon line
    hCtx.strokeStyle = "#ffffff";
    hCtx.lineWidth = 3;
    hCtx.beginPath();
    hCtx.moveTo(-r, pitchOffset);
    hCtx.lineTo(r, pitchOffset);
    hCtx.stroke();

    hCtx.restore();

    // Static Crosshairs
    hCtx.strokeStyle = "#e11d48";
    hCtx.lineWidth = 4;
    
    hCtx.beginPath();
    hCtx.moveTo(cx - 60, cy);
    hCtx.lineTo(cx - 20, cy);
    hCtx.lineTo(cx - 20, cy + 15);
    hCtx.stroke();

    hCtx.beginPath();
    hCtx.moveTo(cx + 60, cy);
    hCtx.lineTo(cx + 20, cy);
    hCtx.lineTo(cx + 20, cy + 15);
    hCtx.stroke();

    hCtx.fillStyle = "#e11d48";
    hCtx.beginPath();
    hCtx.arc(cx, cy, 5, 0, 2 * Math.PI);
    hCtx.fill();
}

drawArtificialHorizon(0, 0);

// ==========================================
// 3. TELEMETRY SYSTEM LOOP WITH ATTITUDE PACKETS
// ==========================================
function generateTelemetryPacket() {
    packetCount++;
    
    const altitude = Math.max(0, 500 - (packetCount * 8.5)); 
    const pressure = 101325 + (packetCount * 90);           
    const temperature = 15 + (packetCount * 0.3);           
    const battery = Math.max(3.2, (4.2 - (packetCount * 0.01))).toFixed(2);
    
    let descentRate = 8.5; 
    if (packetCount > 20 && packetCount < 35) descentRate = 14.2; 
    
    let gpsStatus = 0; 
    if (packetCount > 40 && packetCount < 50) gpsStatus = 1;      

    const payloadSeparation = (packetCount > 15) ? 0 : 1;        
    const emergencyParachute = (descentRate > 12) ? 1 : 0;        

    const currentLat = startingLat + (packetCount * 0.0001);
    const currentLng = startingLng + (packetCount * 0.00015);

    // Freeze dynamic drift orientation if landed
    const roll = (altitude <= 0) ? "0.0" : (Math.sin(packetCount * 0.4) * 25).toFixed(1);
    const pitch = (altitude <= 0) ? "0.0" : (Math.cos(packetCount * 0.3) * 15).toFixed(1);
    const yaw = (altitude <= 0) ? telemetryHistory[telemetryHistory.length - 1]?.yaw || "0.0" : ((packetCount * 4.5) % 360).toFixed(1);

    return `${packetCount},${altitude.toFixed(1)},${pressure.toFixed(0)},${temperature.toFixed(1)},${descentRate.toFixed(1)},${battery},${currentLat.toFixed(4)},${currentLng.toFixed(4)},${descentRate},${gpsStatus},${payloadSeparation},${emergencyParachute},${roll},${pitch},${yaw}`;
}

function parseAndProcessTelemetry(packetStr) {
    const data = packetStr.split(',');
    
    const packetNum = data[0];
    const alt = parseFloat(data[1]);
    const pres = data[2];
    const temp = data[3];
    const descent = parseFloat(data[4]);
    const batt = data[5];
    const lat = parseFloat(data[6]);
    const lng = parseFloat(data[7]);
    
    const f1 = (descent < 8.0 || descent > 10.0) ? "1" : "0";
    const f2 = data[9];  
    const f3 = data[10]; 
    const f4 = data[11]; 

    const roll = parseFloat(data[12]);
    const pitch = parseFloat(data[13]);
    const yaw = data[14];

    // 1. Update text fields in standard DOM layout
    document.getElementById('tel-packet').innerText = packetNum;
    document.getElementById('tel-alt').innerText = alt;
    document.getElementById('tel-pres').innerText = pres;
    document.getElementById('tel-temp').innerText = temp;
    document.getElementById('tel-descent').innerText = (alt <= 0) ? "0.0" : descent;
    document.getElementById('tel-batt').innerText = batt;
    document.getElementById('tel-roll').innerText = roll;
    document.getElementById('tel-pitch').innerText = pitch;
    document.getElementById('tel-yaw').innerText = yaw;

    // 2. Append values to active dataset matrices
    telemetryHistory.push({ packetNum, alt, pres, temp, descent, batt, lat, lng, roll, pitch, yaw, errorCode: `${f1}${f2}${f3}${f4}` });

    // 3. Refresh live analytical charts
    if (telemetryChart.data.labels.length > 15) {
        telemetryChart.data.labels.shift();
        telemetryChart.data.datasets[0].data.shift();
        telemetryChart.data.datasets[1].data.shift();
    }
    telemetryChart.data.labels.push(`P-${packetNum}`);
    telemetryChart.data.datasets[0].data.push(alt);
    telemetryChart.data.datasets[1].data.push(temp);
    telemetryChart.update();

    // 4. Update GPS spatial system markers
    if (f2 === "0") { 
        const newPos = [lat, lng];
        droneMarker.setLatLng(newPos);
        pathHistory.addLatLng(newPos);
        map.panTo(newPos);
    }

    // 5. Update the graphical Artificial Horizon instrument
    drawArtificialHorizon(roll, pitch);

    // 6. Evaluate Dashboard Safety/Fault Logic Blocks
    updateFaultMonitoringSystem(f1, f2, f3, f4);

    // Unified Flight Status Log Ticker
    if (alt > 0) {
        let logs = [];
        
        if (f1 === "1") logs.push("CRITICAL ALERT: Descent Rate Exceeds Safety Threshold!");
        if (f2 === "1") logs.push("ALERT: GPS Tracking Link Down / Lost Signal!");
        if (f3 === "1") logs.push("ALERT: Payload Separation Fault Detected!");
        if (f4 === "1") logs.push("SYSTEM: Emergency Parachute Deployed.");
        
        // If there are active logs, join them with a separator line
        if (logs.length > 0) {
            document.getElementById('cmd-log').innerHTML = logs.join("<br>");
        }
    }

    // Auto-terminate landing simulation sequence loop safely at 0m altitude
    if (alt <= 0 && streamInterval !== null) {
        clearInterval(streamInterval);
        streamInterval = null;
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('connection-status').innerText = "MISSION COMPLETED (LANDED)";
        document.getElementById('connection-status').className = "status-badge connected";
        document.getElementById('cmd-log').innerText = "TOUCHDOWN CONFIRMED: Stream auto-terminated safely.";
    }
}

function updateFaultMonitoringSystem(d1, d2, d3, d4) {
    const digits = [d1, d2, d3, d4];
    for (let i = 1; i <= 4; i++) {
        const element = document.getElementById(`err-digit-${i}`);
        const label = document.getElementById(`err-lbl-${i}`);
        element.innerText = digits[i-1];
        if (digits[i-1] === "1") {
            element.className = "err-digit fault";
            label.className = "active-fault";
        } else {
            element.className = "err-digit normal";
            label.className = "";
        }
    }
}

// ==========================================
// 4. INTERFACE BUTTON ACTION EVENT HANDLERS
// ==========================================
document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('connection-status').innerText = "STREAMING ACTIVE";
    document.getElementById('connection-status').className = "status-badge connected";
    
    streamInterval = setInterval(() => {
        const rawPacket = generateTelemetryPacket();
        parseAndProcessTelemetry(rawPacket);
    }, 1000); 
});

document.getElementById('btn-stop').addEventListener('click', () => {
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-stop').disabled = true;
    document.getElementById('connection-status').innerText = "DISCONNECTED";
    document.getElementById('connection-status').className = "status-badge disconnected";
    clearInterval(streamInterval);
    streamInterval = null;
});

document.getElementById('btn-reset').addEventListener('click', () => {
    packetCount = 0;
    telemetryHistory = [];
    telemetryChart.data.labels = [];
    telemetryChart.data.datasets[0].data = [];
    telemetryChart.data.datasets[1].data = [];
    telemetryChart.update();
    pathHistory.setLatLngs([]);
    droneMarker.setLatLng([startingLat, startingLng]);
    map.setView([startingLat, startingLng], 15);
    document.getElementById('tel-packet').innerText = "0";
    drawArtificialHorizon(0, 0);
    updateFaultMonitoringSystem("0", "0", "0", "0");
    document.getElementById('cmd-log').innerText = "Awaiting launch configurations...";
});

document.getElementById('btn-sync').addEventListener('click', () => {
    document.getElementById('cmd-log').innerText = `Clock sync complete: ${new Date().toLocaleTimeString()}`;
});

document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (telemetryHistory.length === 0) return alert("No telemetry logged yet.");
    let csvContent = "data:text/csv;charset=utf-8,Packet,Altitude,Pressure,Temperature,DescentRate,Battery,Lat,Lng,Roll,Pitch,Yaw,ErrorCode\n";
    telemetryHistory.forEach(r => {
        csvContent += `${r.packetNum},${r.alt},${r.pres},${r.temp},${r.descent},${r.batt},${r.lat},${r.lng},${r.roll},${r.pitch},${r.yaw},${r.errorCode}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `cansat_telemetry_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('cmd-separation').addEventListener('click', () => {
    document.getElementById('cmd-log').innerText = "CMD SENT: Manual Separation Forced.";
});
document.getElementById('cmd-parachute').addEventListener('click', () => {
    document.getElementById('cmd-log').innerText = "CRITICAL: Emergency Parachute Deployed Manually.";
});
document.getElementById('cmd-redundant').addEventListener('click', () => {
    document.getElementById('cmd-log').innerText = "CMD SENT: Secondary Circuit Fired.";
});

// ==========================================
// 5. GRAPH IMAGE EXPORT UTILITY
// ==========================================
document.getElementById('btn-export-graph').addEventListener('click', () => {
    // Captures the current rendering context canvas state from Chart.js
    const imageURI = telemetryChart.toBase64Image();
    
    // Programmatic anchor instantiation to trigger local client filesystem download
    const link = document.createElement("a");
    link.href = imageURI;
    link.download = `cansat_graph_export_${Date.now()}.png`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});