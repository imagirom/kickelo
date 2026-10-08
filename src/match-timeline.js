// src/match-timeline.js

// Utility: format ms to mm:ss
export function formatMsToMMSS(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Create SVG timeline for a match's goalLog, with dynamic width and fixed height.
// totalTime: length of the line (defaults to the last goal; a running match passes its elapsed time).
export function createTimelineSVG(goalLog, width = 400, totalTime = goalLog?.[goalLog.length - 1]?.timestamp || 0) {
    if (!Array.isArray(goalLog)) return null;
    const height = 32;
    const margin = 18;
    const lineY = height / 2;
    const dotRadius = 5;
    const dotOffset = 8; // Offset for goal dots above/below the line
    const markersHeight = 8; // Height of minute markers above the line
    const lineStart = margin;
    const lineEnd = width - margin;
    if (totalTime <= 0) return null;
    // Minute markers
    const minuteMarkers = [];
    const nMinutes = Math.floor(totalTime / 60000);
    for (let m = 1; m <= nMinutes; m++) {
        const x = lineStart + ((lineEnd - lineStart) * (m * 60000) / totalTime);
        minuteMarkers.push(`<line x1="${x}" y1="${lineY - markersHeight/2}" x2="${x}" y2="${lineY + markersHeight/2}" stroke="#888" stroke-width="2" />`);
    }
    // Goal dots
    const dots = goalLog.map((goal) => {
        const x = lineStart + ((lineEnd - lineStart) * Math.min(goal.timestamp, totalTime) / totalTime);
        const y = goal.team === 'red' ? lineY - dotOffset : lineY + dotOffset;
        // use colors from css
        // const color = goal.team === 'red' ? '#cc6a75' : '#6baac0';
        // const color = goal.team === 'red' ? 'rgba(106, 37, 45, 0.8)' : 'rgba(49, 76, 86, 0.8)';
        const stroke_color = goal.team === 'red' ? '#cc6a75' : '#6baac0';
        const color = goal.team === 'red' ? '#cc6a75' : '#6baac0';
        const title = `${goal.team === 'red' ? 'Red' : 'Blue'} goal at ${formatMsToMMSS(goal.timestamp)}`;
        return `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${color}" stroke="${stroke_color}" stroke-width="0" fill-opacity="0.8"><title>${title}</title></circle>`;
    }).join('');
    // Timeline line
    const line = `<line x1="${lineStart}" y1="${lineY}" x2="${lineEnd}" y2="${lineY}" stroke="#888" stroke-width="2" />`;
    return `<svg width="${width}" height="36" viewBox="0 0 ${width} ${height}" style="height:${height}; width:100%; display:block;">
        ${line}
        ${minuteMarkers.join('')}
        ${dots}
    </svg>`;
}

// Create a flex container with the timeline SVG and the total time label, with dynamic width
export function createTimelineWithLabel(goalLog) {
    const totalTime = goalLog && goalLog.length > 0 ? goalLog[goalLog.length - 1].timestamp || 0 : 0;
    if (totalTime <= 0) return null;
    // Create container first to measure width
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '0px';
    container.style.width = '100%';
    container.style.justifyContent = 'space-between';
    // SVG timeline
    const svgDiv = document.createElement('div');
    svgDiv.style.flex = '1 1 auto';
    // Use a default width first
    let width = 400;
    // Try to measure parent width if possible
    if (container.parentElement) {
        width = Math.max(container.parentElement.clientWidth || 400, 200);
    }
    svgDiv.innerHTML = createTimelineSVG(goalLog, width);
    // Time label
    const timeLabel = document.createElement('span');
    timeLabel.textContent = formatMsToMMSS(totalTime);
    timeLabel.style.fontSize = '13px';
    timeLabel.style.color = '#888';
    timeLabel.style.fontFamily = 'monospace';
    timeLabel.style.flex = 'none';
    container.appendChild(svgDiv);
    container.appendChild(timeLabel);
    // Responsive: re-render SVG on resize
    const resizeObserver = new window.ResizeObserver(entries => {
        for (const entry of entries) {
            const newWidth = Math.max(entry.contentRect.width, 200);
            svgDiv.innerHTML = createTimelineSVG(goalLog, newWidth);
        }
    });
    resizeObserver.observe(container);
    return container;
}
