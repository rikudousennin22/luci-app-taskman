'use strict';
'require view';
'require fs';
'require ui';
'require rpc';

var callPerfStats = rpc.declare({
	object: 'luci.taskman',
	method: 'get_perf_stats',
	expect: {}
});

var callToggleFbstreamer = rpc.declare({
	object: 'luci.taskman',
	method: 'toggle_fbstreamer',
	params: ['enable']
});

var callProcessList = rpc.declare({
	object: 'luci',
	method: 'getProcessList',
	expect: { result: [] }
});

var callKillProcess = rpc.declare({
	object: 'luci.taskman',
	method: 'kill_process',
	params: ['pid', 'signal']
});

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info',
	expect: {}
});

var callBoardInfo = rpc.declare({
	object: 'system',
	method: 'board',
	expect: {}
});

function sprintf(fmt) {
	var args = Array.prototype.slice.call(arguments, 1);
	var i = 0;
	return String(fmt).replace(/%([sdjf%])/g, function(m, type) {
		if (m === '%%') return '%';
		if (i >= args.length) return m;
		var arg = args[i++];
		if (type === 'd') return parseInt(arg, 10);
		if (type === 'f') return parseFloat(arg);
		return String(arg);
	});
}

function extractProcesses(raw) {
	if (Array.isArray(raw)) return raw;
	if (raw && Array.isArray(raw.result)) return raw.result;
	return [];
}

return view.extend({
	pollInterval: 1000,
	timerId: null,
	activeTab: 'perf',
	activePerfSubTab: 'cpu',
	searchQuery: '',
	sortField: 'cpu',
	sortAsc: false,
	containerNode: null,
	
	prevStats: null,
	lastGpuStats: null,
	lastTimestamp: 0,
	lastProcesses: [],
	
	// History buffers (60 data points)
	history: {
		cpuTotal: [],
		cpuCores: [[], [], [], [], [], []],
		memUsedPct: [],
		netRx: [],
		netTx: [],
		diskRead: [],
		diskWrite: []
	},
	
	load: function() {
		return Promise.all([
			callBoardInfo(),
			callSystemInfo(),
			callPerfStats()
		]);
	},

	render: function(data) {
		var board = data[0] || {};
		var sysInfo = data[1] || {};
		var initialStats = data[2] || {};
		var initialProcs = (initialStats.processes && Array.isArray(initialStats.processes) && initialStats.processes.length > 0) ?
			initialStats.processes : [];
		
		var container = E('div', { 'class': 'taskman-container' });
		this.containerNode = container;
		
		// Inject Taskman Styles
		var styleTag = E('style', {}, `
			.taskman-container {
				font-family: var(--font-body, "Microsoft Yahei", sans-serif);
				color: var(--text-primary, #0f172a);
				padding: 0 0 2rem 0;
			}
			.taskman-header {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
				background: var(--card-bg, #ffffff);
				border: 1px solid var(--card-border, #e2e8f0);
				border-radius: 12px;
				padding: 1.2rem 1.5rem;
				margin-bottom: 1.25rem;
				box-shadow: 0 2px 6px rgba(0,0,0,0.03);
			}
			.taskman-title-group {
				display: flex;
				align-items: center;
				gap: 12px;
			}
			.taskman-icon-badge {
				width: 44px;
				height: 44px;
				border-radius: 10px;
				background: linear-gradient(135deg, #0284c7, #0e7490);
				display: flex;
				align-items: center;
				justify-content: center;
				color: #fff;
				font-size: 22px;
				box-shadow: 0 4px 10px rgba(14, 116, 144, 0.3);
			}
			.taskman-title h2 {
				margin: 0;
				font-size: 1.35rem;
				font-weight: 700;
				color: var(--text-primary, #0f172a);
				line-height: 1.2;
			}
			.taskman-subtitle {
				font-size: 0.82rem;
				color: var(--text-muted, #64748b);
				margin-top: 3px;
			}
			.taskman-controls {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.taskman-btn-group {
				display: inline-flex;
				background: var(--page-bg, #f1f5f9);
				border-radius: 8px;
				padding: 3px;
				border: 1px solid var(--card-border, #cbd5e1);
			}
			.taskman-interval-btn {
				background: transparent;
				border: none;
				padding: 4px 12px;
				font-size: 12px;
				font-weight: 600;
				color: var(--text-secondary, #475569);
				border-radius: 6px;
				cursor: pointer;
				transition: all 0.15s ease;
			}
			.taskman-interval-btn.active {
				background: var(--card-bg, #ffffff);
				color: var(--main-color, #0e7490);
				box-shadow: 0 1px 4px rgba(0,0,0,0.1);
			}
			.taskman-stats-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-bottom: 1.25rem;
			}
			.taskman-chip {
				flex: 1 1 calc(20% - 8px);
				min-width: 170px;
				background: var(--card-bg, #ffffff);
				border: 1px solid var(--card-border, #e2e8f0);
				border-radius: 10px;
				padding: 10px 14px;
				display: flex;
				align-items: center;
				justify-content: space-between;
				box-shadow: 0 1px 3px rgba(0,0,0,0.02);
				cursor: pointer;
				transition: all 0.2s ease;
			}
			.taskman-chip:hover {
				border-color: var(--main-color, #0e7490);
				transform: translateY(-1px);
			}
			.taskman-chip-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--text-muted, #64748b);
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}
			.taskman-chip-val {
				font-size: 1.25rem;
				font-weight: 700;
				color: var(--text-primary, #0f172a);
				margin-top: 2px;
			}
			.taskman-chip-sub {
				font-size: 11px;
				color: var(--text-muted, #64748b);
			}
			.taskman-chip-indicator {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background: #10b981;
			}
			.taskman-chip-indicator.pulse {
				animation: taskman-pulse 1.8s infinite;
			}
			@keyframes taskman-pulse {
				0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
				70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
				100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
			}
			.taskman-nav-tabs {
				display: flex;
				border-bottom: 2px solid var(--card-border, #e2e8f0);
				margin-bottom: 1.25rem;
				gap: 4px;
			}
			.taskman-tab-btn {
				background: transparent;
				border: none;
				padding: 10px 18px;
				font-size: 14px;
				font-weight: 600;
				color: var(--text-muted, #64748b);
				border-bottom: 2px solid transparent;
				margin-bottom: -2px;
				cursor: pointer;
				transition: all 0.2s ease;
				display: inline-flex;
				align-items: center;
				gap: 6px;
			}
			.taskman-tab-btn:hover {
				color: var(--text-primary, #0f172a);
			}
			.taskman-tab-btn.active {
				color: var(--main-color, #0e7490);
				border-bottom: 2px solid var(--main-color, #0e7490);
			}
			.taskman-panel {
				display: none;
			}
			.taskman-panel.active {
				display: block;
			}
			.taskman-perf-layout {
				display: grid;
				grid-template-columns: 200px 1fr;
				gap: 1.25rem;
			}
			@media (max-width: 900px) {
				.taskman-perf-layout {
					grid-template-columns: 1fr;
				}
			}
			.taskman-perf-nav {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.taskman-perf-nav-item {
				background: var(--card-bg, #ffffff);
				border: 1px solid var(--card-border, #e2e8f0);
				border-radius: 8px;
				padding: 12px;
				cursor: pointer;
				transition: all 0.15s ease;
			}
			.taskman-perf-nav-item:hover {
				border-color: var(--main-color, #0e7490);
			}
			.taskman-perf-nav-item.active {
				background: var(--page-bg, #f1f5f9);
				border-color: var(--main-color, #0e7490);
				border-left: 4px solid var(--main-color, #0e7490);
			}
			.taskman-perf-nav-title {
				font-weight: 600;
				font-size: 13px;
			}
			.taskman-perf-nav-val {
				font-size: 18px;
				font-weight: 700;
				margin-top: 4px;
				color: var(--main-color, #0e7490);
			}
			.taskman-perf-nav-desc {
				font-size: 11px;
				color: var(--text-muted, #64748b);
			}
			.taskman-card {
				background: var(--card-bg, #ffffff);
				border: 1px solid var(--card-border, #e2e8f0);
				border-radius: 12px;
				padding: 1.25rem;
				box-shadow: 0 2px 6px rgba(0,0,0,0.03);
			}
			.taskman-chart-box {
				width: 100%;
				height: 200px;
				position: relative;
				margin: 10px 0;
			}
			.taskman-chart-box canvas {
				width: 100% !important;
				height: 100% !important;
				display: block;
			}
			.taskman-cores-grid {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 12px;
				margin-top: 1.25rem;
			}
			@media (max-width: 768px) {
				.taskman-cores-grid {
					grid-template-columns: repeat(2, 1fr);
				}
			}
			@media (max-width: 480px) {
				.taskman-cores-grid {
					grid-template-columns: 1fr;
				}
			}
			.taskman-core-box {
				background: var(--page-bg, #f8fafc);
				border: 1px solid var(--card-border, #e2e8f0);
				border-radius: 8px;
				padding: 10px;
			}
			.taskman-core-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				font-size: 12px;
				font-weight: 600;
				margin-bottom: 6px;
			}
			.taskman-core-chart {
				width: 100%;
				height: 60px;
			}
			.taskman-core-chart canvas {
				width: 100% !important;
				height: 100% !important;
			}
			.taskman-proc-toolbar {
				display: flex;
				flex-wrap: wrap;
				justify-content: space-between;
				align-items: center;
				gap: 10px;
				margin-bottom: 12px;
			}
			.taskman-search-input {
				padding: 8px 12px;
				border-radius: 6px;
				border: 1px solid var(--card-border, #cbd5e1);
				background: var(--input-bg, #ffffff);
				color: var(--text-primary, #0f172a);
				min-width: 250px;
				font-size: 13px;
			}
			.taskman-table {
				width: 100%;
				border-collapse: collapse;
				font-size: 12px;
			}
			.taskman-table th {
				background: var(--page-bg, #f1f5f9);
				color: var(--text-secondary, #475569);
				font-weight: 600;
				text-align: left;
				padding: 8px 10px;
				border-bottom: 2px solid var(--card-border, #cbd5e1);
				cursor: pointer;
				user-select: none;
			}
			.taskman-table th:hover {
				background: var(--card-border, #e2e8f0);
			}
			.taskman-table td {
				padding: 8px 10px;
				border-bottom: 1px solid var(--card-border, #f1f5f9);
			}
			.taskman-table tr:hover td {
				background: var(--page-bg, #f8fafc);
			}
			.taskman-progress-bar-bg {
				width: 80px;
				height: 6px;
				background: var(--card-border, #e2e8f0);
				border-radius: 3px;
				overflow: hidden;
				display: inline-block;
				margin-left: 6px;
				vertical-align: middle;
			}
			.taskman-progress-bar-fill {
				height: 100%;
				background: #0284c7;
				border-radius: 3px;
			}
			.taskman-status-badge {
				display: inline-block;
				padding: 2px 6px;
				border-radius: 4px;
				font-size: 10px;
				font-weight: 700;
				text-transform: uppercase;
			}
			.taskman-status-running {
				background: #dcfce7;
				color: #15803d;
			}
			.taskman-status-sleeping {
				background: #f1f5f9;
				color: #64748b;
			}
			.taskman-end-btn {
				background: #ef4444;
				color: #ffffff;
				border: none;
				border-radius: 4px;
				padding: 4px 10px;
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
				transition: background 0.15s ease;
			}
			.taskman-end-btn:hover {
				background: #dc2626;
			}
			.taskman-modal-overlay {
				position: fixed;
				top: 0; left: 0; right: 0; bottom: 0;
				background: rgba(0,0,0,0.5);
				display: flex;
				align-items: center;
				justify-content: center;
				z-index: 9999;
			}
			.taskman-modal {
				background: var(--card-bg, #ffffff);
				border: 1px solid var(--card-border, #cbd5e1);
				border-radius: 12px;
				padding: 1.5rem;
				width: 90%;
				max-width: 440px;
				box-shadow: 0 10px 25px rgba(0,0,0,0.25);
			}
		`);
		container.appendChild(styleTag);

		// Render Header
		var header = E('div', { 'class': 'taskman-header' }, [
			E('div', { 'class': 'taskman-title-group' }, [
				E('div', { 'class': 'taskman-icon-badge' }, '⚡'),
				E('div', { 'class': 'taskman-title' }, [
					E('h2', {}, _('Task Manager')),
					E('div', { 'class': 'taskman-subtitle' }, sprintf('%s (%s) — %s', board.model || 'OpenWrt', board.board_name || 'SoC', board.release?.description || 'OpenWrt 24.10'))
				])
			]),
			E('div', { 'class': 'taskman-controls' }, [
				E('span', { 'style': 'font-size: 11px; font-weight: 600; color: var(--text-muted);' }, _('Update:')),
				E('div', { 'class': 'taskman-btn-group' }, [
					E('button', { 'class': 'taskman-interval-btn active', 'data-interval': '1000' }, '1s'),
					E('button', { 'class': 'taskman-interval-btn', 'data-interval': '2000' }, '2s'),
					E('button', { 'class': 'taskman-interval-btn', 'data-interval': '5000' }, '5s'),
					E('button', { 'class': 'taskman-interval-btn', 'data-interval': '0' }, '⏸ ' + _('Pause'))
				])
			])
		]);
		container.appendChild(header);

		// Quick Status Chips
		var chipsBox = E('div', { 'class': 'taskman-stats-chips' }, [
			E('div', { 'class': 'taskman-chip', 'data-target': 'cpu' }, [
				E('div', {}, [
					E('div', { 'class': 'taskman-chip-label' }, 'CPU'),
					E('div', { 'class': 'taskman-chip-val', 'id': 'chip-cpu-val' }, '0%'),
					E('div', { 'class': 'taskman-chip-sub', 'id': 'chip-cpu-freq' }, '6 Cores')
				]),
				E('div', { 'class': 'taskman-chip-indicator pulse', 'id': 'chip-cpu-ind' })
			]),
			E('div', { 'class': 'taskman-chip', 'data-target': 'mem' }, [
				E('div', {}, [
					E('div', { 'class': 'taskman-chip-label' }, _('Memory')),
					E('div', { 'class': 'taskman-chip-val', 'id': 'chip-mem-val' }, '0%'),
					E('div', { 'class': 'taskman-chip-sub', 'id': 'chip-mem-sub' }, '0 / 0 MB')
				]),
				E('div', { 'class': 'taskman-chip-indicator', 'id': 'chip-mem-ind' })
			]),
			E('div', { 'class': 'taskman-chip', 'data-target': 'temp' }, [
				E('div', {}, [
					E('div', { 'class': 'taskman-chip-label' }, _('SoC Temp')),
					E('div', { 'class': 'taskman-chip-val', 'id': 'chip-temp-val' }, '--°C'),
					E('div', { 'class': 'taskman-chip-sub' }, 'thermal_zone0')
				]),
				E('div', { 'class': 'taskman-chip-indicator', 'id': 'chip-temp-ind', 'style': 'background:#38bdf8;' })
			]),
			E('div', { 'class': 'taskman-chip', 'data-target': 'net' }, [
				E('div', {}, [
					E('div', { 'class': 'taskman-chip-label' }, _('Network')),
					E('div', { 'class': 'taskman-chip-val', 'id': 'chip-net-val', 'style': 'font-size:1.05rem;' }, '↓ 0 KB/s'),
					E('div', { 'class': 'taskman-chip-sub', 'id': 'chip-net-sub' }, '↑ 0 KB/s')
				]),
				E('div', { 'class': 'taskman-chip-indicator', 'id': 'chip-net-ind', 'style': 'background:#a855f7;' })
			]),
			E('div', { 'class': 'taskman-chip', 'data-target': 'gpu' }, [
				E('div', {}, [
					E('div', { 'class': 'taskman-chip-label' }, _('Display Engine')),
					E('div', { 'class': 'taskman-chip-val', 'id': 'chip-gpu-val', 'style': 'font-size:1.1rem;' }, '1080p'),
					E('div', { 'class': 'taskman-chip-sub', 'id': 'chip-gpu-sub' }, 'SimpleDRM fb0')
				]),
				E('div', { 'class': 'taskman-chip-indicator', 'id': 'chip-gpu-ind', 'style': 'background:#f59e0b;' })
			])
		]);
		container.appendChild(chipsBox);

		// Tabs Bar
		var tabsBar = E('div', { 'class': 'taskman-nav-tabs' }, [
			E('button', { 'class': 'taskman-tab-btn active', 'data-tab': 'perf' }, '📊 ' + _('Performance')),
			E('button', { 'class': 'taskman-tab-btn', 'data-tab': 'proc' }, '📋 ' + _('Processes')),
			E('button', { 'class': 'taskman-tab-btn', 'data-tab': 'gpu' }, '🖥️ ' + _('GPU & Display')),
			E('button', { 'class': 'taskman-tab-btn', 'data-tab': 'sys' }, 'ℹ️ ' + _('System Details'))
		]);
		container.appendChild(tabsBar);

		// ==========================================
		// TAB 1: PERFORMANCE
		// ==========================================
		var panelPerf = E('div', { 'class': 'taskman-panel active', 'id': 'panel-perf' }, [
			E('div', { 'class': 'taskman-perf-layout' }, [
				// Sub-navigation on left
				E('div', { 'class': 'taskman-perf-nav' }, [
					E('div', { 'class': 'taskman-perf-nav-item active', 'data-subtab': 'cpu' }, [
						E('div', { 'class': 'taskman-perf-nav-title' }, 'CPU'),
						E('div', { 'class': 'taskman-perf-nav-val', 'id': 'perf-nav-cpu-val' }, '0%'),
						E('div', { 'class': 'taskman-perf-nav-desc', 'id': 'perf-nav-cpu-desc' }, '1.70 GHz (6 Cores)')
					]),
					E('div', { 'class': 'taskman-perf-nav-item', 'data-subtab': 'mem' }, [
						E('div', { 'class': 'taskman-perf-nav-title' }, _('Memory')),
						E('div', { 'class': 'taskman-perf-nav-val', 'id': 'perf-nav-mem-val' }, '0%'),
						E('div', { 'class': 'taskman-perf-nav-desc', 'id': 'perf-nav-mem-desc' }, '1.6 GB RAM')
					]),
					E('div', { 'class': 'taskman-perf-nav-item', 'data-subtab': 'net' }, [
						E('div', { 'class': 'taskman-perf-nav-title' }, _('Network')),
						E('div', { 'class': 'taskman-perf-nav-val', 'id': 'perf-nav-net-val', 'style': 'font-size:14px;' }, '0 KB/s'),
						E('div', { 'class': 'taskman-perf-nav-desc' }, 'Throughput')
					]),
					E('div', { 'class': 'taskman-perf-nav-item', 'data-subtab': 'disk' }, [
						E('div', { 'class': 'taskman-perf-nav-title' }, _('Disk I/O')),
						E('div', { 'class': 'taskman-perf-nav-val', 'id': 'perf-nav-disk-val', 'style': 'font-size:14px;' }, '0 KB/s'),
						E('div', { 'class': 'taskman-perf-nav-desc' }, 'mmcblk0')
					])
				]),
				
				// Details Card on right
				E('div', { 'class': 'taskman-card' }, [
					// CPU Sub-Panel
					E('div', { 'id': 'subpanel-cpu' }, [
						E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
							E('h3', { 'style': 'margin:0; font-size:1.15rem;' }, 'CPU — ' + (board.system || 'Realtek Hexa-Core ARMv8')),
							E('span', { 'id': 'cpu-main-label', 'style': 'font-size:1.3rem; font-weight:700; color:var(--main-color, #0284c7);' }, '0%')
						]),
						E('div', { 'class': 'taskman-chart-box' }, [
							E('canvas', { 'id': 'chart-cpu-total' })
						]),
						E('div', { 'style': 'margin-top:1.5rem; display:flex; justify-content:space-between; align-items:center;' }, [
							E('h4', { 'style': 'margin:0; font-size:0.95rem;' }, 'Logical Processors (6 Cores RTD1619B)'),
							E('span', { 'id': 'cpu-cores-summary', 'style': 'font-size:11px; color:var(--text-muted);' }, 'Scaling: schedutil @ 1.70 GHz')
						]),
						E('div', { 'class': 'taskman-cores-grid' }, [
							this.createCoreBox(0),
							this.createCoreBox(1),
							this.createCoreBox(2),
							this.createCoreBox(3),
							this.createCoreBox(4),
							this.createCoreBox(5)
						])
					]),

					// Memory Sub-Panel
					E('div', { 'id': 'subpanel-mem', 'style': 'display:none;' }, [
						E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
							E('h3', { 'style': 'margin:0; font-size:1.15rem;' }, _('Memory Usage (RAM)')),
							E('span', { 'id': 'mem-main-label', 'style': 'font-size:1.3rem; font-weight:700; color:#0e7490;' }, '0%')
						]),
						E('div', { 'class': 'taskman-chart-box' }, [
							E('canvas', { 'id': 'chart-mem-total' })
						]),
						E('div', { 'id': 'mem-breakdown-box', 'style': 'margin-top:1.25rem;' }, [
							E('div', { 'style': 'display:flex; height:20px; border-radius:6px; overflow:hidden; margin-bottom:10px; background:#e2e8f0;' }, [
								E('div', { 'id': 'mem-bar-used', 'style': 'background:#0284c7; width:20%;' }),
								E('div', { 'id': 'mem-bar-cached', 'style': 'background:#10b981; width:10%;' }),
								E('div', { 'id': 'mem-bar-free', 'style': 'background:#cbd5e1; width:70%;' })
							]),
							E('div', { 'id': 'mem-details-grid', 'style': 'display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; font-size:12px;' })
						])
					]),

					// Network Sub-Panel
					E('div', { 'id': 'subpanel-net', 'style': 'display:none;' }, [
						E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
							E('h3', { 'style': 'margin:0; font-size:1.15rem;' }, _('Network Throughput')),
							E('span', { 'id': 'net-main-label', 'style': 'font-size:1.1rem; font-weight:700; color:#a855f7;' }, '↓ 0 KB/s  ↑ 0 KB/s')
						]),
						E('div', { 'class': 'taskman-chart-box' }, [
							E('canvas', { 'id': 'chart-net-total' })
						]),
						E('div', { 'id': 'net-interfaces-table-box', 'style': 'margin-top:1.25rem; overflow-x:auto;' })
					]),

					// Disk Sub-Panel
					E('div', { 'id': 'subpanel-disk', 'style': 'display:none;' }, [
						E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
							E('h3', { 'style': 'margin:0; font-size:1.15rem;' }, _('Disk & Storage Activity')),
							E('span', { 'id': 'disk-main-label', 'style': 'font-size:1.1rem; font-weight:700; color:#f59e0b;' }, 'R: 0 KB/s  W: 0 KB/s')
						]),
						E('div', { 'class': 'taskman-chart-box' }, [
							E('canvas', { 'id': 'chart-disk-total' })
						]),
						E('div', { 'id': 'disk-partitions-box', 'style': 'margin-top:1.25rem;' })
					])
				])
			])
		]);
		container.appendChild(panelPerf);

		// ==========================================
		// TAB 2: PROCESSES
		// ==========================================
		var panelProc = E('div', { 'class': 'taskman-panel', 'id': 'panel-proc' }, [
			E('div', { 'class': 'taskman-card' }, [
				E('div', { 'class': 'taskman-proc-toolbar' }, [
					E('input', {
						'type': 'text',
						'class': 'taskman-search-input',
						'id': 'proc-search-input',
						'placeholder': _('Search by name, PID, or user...')
					}),
					E('div', { 'id': 'proc-stats-summary', 'style': 'font-size:12px; font-weight:600; color:var(--text-muted);' }, 'Total: 0')
				]),
				E('div', { 'style': 'overflow-x:auto;' }, [
					E('table', { 'class': 'taskman-table' }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', { 'data-sort': 'name' }, _('Process Name') + ' ↕'),
								E('th', { 'data-sort': 'pid' }, 'PID ↕'),
								E('th', { 'data-sort': 'user' }, 'User ↕'),
								E('th', { 'data-sort': 'status' }, 'Status ↕'),
								E('th', { 'data-sort': 'cpu' }, '% CPU ↕'),
								E('th', { 'data-sort': 'mem' }, '% RAM ↕'),
								E('th', { 'data-sort': 'vsz' }, 'Memory (VSZ) ↕'),
								E('th', { 'style': 'text-align:right;' }, _('Action'))
							])
						]),
						E('tbody', { 'id': 'proc-table-tbody' })
					])
				])
			])
		]);
		container.appendChild(panelProc);

		// ==========================================
		// TAB 3: GPU & DISPLAY
		// ==========================================
		var panelGPU = E('div', { 'class': 'taskman-panel', 'id': 'panel-gpu' }, [
			E('div', { 'style': 'display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1.25rem;' }, [
				E('div', { 'class': 'taskman-card' }, [
					E('h3', { 'style': 'margin-top:0; font-size:1.15rem; display:flex; align-items:center; gap:8px;' }, [
						'🖥️', _('Display Controller (SimpleDRM)')
					]),
					E('table', { 'class': 'taskman-table', 'style': 'margin-top:1rem;' }, [
						E('tr', {}, [ E('td', { 'style': 'font-weight:600; width:40%;' }, 'Device Node'), E('td', {}, '/dev/dri/card0') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Resolution'), E('td', {}, '1920 × 1080 (Full HD)') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Color Depth'), E('td', {}, '32-bit RGB (XR24 Format)') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Pitch / Stride'), E('td', {}, '7,680 bytes / scanline') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Dedicated VRAM'), E('td', {}, '8.29 MB Direct Framebuffer') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Kernel Driver'), E('td', {}, 'simpledrm (Linux 7.2.11 DRM Subsystem)') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Hardware Status'), E('td', {}, E('span', { 'class': 'taskman-status-badge taskman-status-running' }, 'Connected & Active')) ])
					])
				]),
				E('div', { 'class': 'taskman-card' }, [
					E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;' }, [
						E('h3', { 'style': 'margin-top:0; font-size:1.15rem; display:flex; align-items:center; gap:8px;' }, [
							'📡', _('HDMI Output Streamer (fbstreamer)')
						]),
						E('button', {
							'id': 'fbstreamer-toggle-btn',
							'class': 'btn cbi-button-action',
							'style': 'font-weight:700; font-size:12px; padding:6px 14px;',
							'click': function() { self.toggleFbstreamerAction(); }
						}, _('Loading...'))
					]),
					E('p', { 'style': 'font-size:12px; color:var(--text-muted); margin:8px 0 12px 0;' },
						_('Streams the STB HDMI display (1080p @ 25 FPS) to a web browser on port 9999. Turning this OFF frees ~380 MB of RAM and reduces CPU usage.')),
					E('table', { 'class': 'taskman-table' }, [
						E('tr', {}, [
							E('td', { 'style': 'font-weight:600; width:40%;' }, _('Service Status')),
							E('td', {}, E('span', { 'id': 'fbstreamer-status-badge', 'class': 'taskman-status-badge' }, '--'))
						]),
						E('tr', {}, [
							E('td', { 'style': 'font-weight:600;' }, _('Streaming Port / URL')),
							E('td', { 'id': 'fbstreamer-url' }, '--')
						]),
						E('tr', {}, [
							E('td', { 'style': 'font-weight:600;' }, _('Memory Usage (VSZ)')),
							E('td', { 'id': 'fbstreamer-mem-vsz', 'style': 'font-weight:600;' }, '--')
						]),
						E('tr', {}, [
							E('td', { 'style': 'font-weight:600;' }, _('Boot Startup (Persistence)')),
							E('td', { 'id': 'fbstreamer-autostart' }, '--')
						]),
						E('tr', {}, [
							E('td', { 'style': 'font-weight:600;' }, _('Capture Mode')),
							E('td', {}, 'Direct Linux Framebuffer /dev/fb0 Mirror')
						])
					])
				])
			])
		]);
		container.appendChild(panelGPU);

		// ==========================================
		// TAB 4: SYSTEM DETAILS
		// ==========================================
		var panelSys = E('div', { 'class': 'taskman-panel', 'id': 'panel-sys' }, [
			E('div', { 'class': 'taskman-card' }, [
				E('h3', { 'style': 'margin-top:0; font-size:1.15rem;' }, 'Hardware & System Specifications'),
				E('div', { 'style': 'display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1.25rem; margin-top:1rem;' }, [
					E('table', { 'class': 'taskman-table' }, [
						E('tr', {}, [ E('td', { 'style': 'font-weight:600; width:45%;' }, 'SoC Model'), E('td', {}, 'Realtek RTD1619B (Mjolnir)') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'CPU Cores'), E('td', {}, '6x ARM Cortex-A55 @ 1.70 GHz') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Architecture'), E('td', {}, 'ARMv8 64-bit (aarch64 / armsr)') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'STB Device'), E('td', {}, board.model || 'X1 PRIME C') ])
					]),
					E('table', { 'class': 'taskman-table' }, [
						E('tr', {}, [ E('td', { 'style': 'font-weight:600; width:45%;' }, 'Linux Kernel'), E('td', {}, '7.2.11 SMP PREEMPT') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'OpenWrt Version'), E('td', {}, board.release?.description || '24.10.7') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'System Uptime'), E('td', { 'id': 'sys-detail-uptime' }, '--') ]),
						E('tr', {}, [ E('td', { 'style': 'font-weight:600;' }, 'Load Average'), E('td', { 'id': 'sys-detail-load' }, '--') ])
					])
				])
			])
		]);
		container.appendChild(panelSys);

		// Setup Listeners
		this.bindEvents(container);
		
		// Initial Render of Processes directly into the container DOM
		this.lastProcesses = initialProcs;
		this.renderProcessTable(initialProcs);
		
		// Initial Tick with loaded data
		var self = this;
		window.requestAnimationFrame(function() {
			self.updateAll(initialStats, initialProcs, sysInfo);
		});
		
		// Start Poller
		this.startPoller();

		return container;
	},

	createCoreBox: function(coreNum) {
		return E('div', { 'class': 'taskman-core-box' }, [
			E('div', { 'class': 'taskman-core-header' }, [
				E('span', {}, 'Core ' + coreNum),
				E('span', { 'id': 'core-val-' + coreNum, 'style': 'color:var(--main-color, #0284c7);' }, '0%')
			]),
			E('div', { 'class': 'taskman-core-chart' }, [
				E('canvas', { 'id': 'chart-core-' + coreNum })
			]),
			E('div', { 'id': 'core-freq-' + coreNum, 'style': 'font-size:10px; color:var(--text-muted); margin-top:4px;' }, '1.70 GHz')
		]);
	},

	bindEvents: function(container) {
		var self = this;
		
		// Top Tab Switching
		var tabBtns = container.querySelectorAll('.taskman-tab-btn');
		tabBtns.forEach(function(btn) {
			btn.addEventListener('click', function() {
				tabBtns.forEach(function(b) { b.classList.remove('active'); });
				btn.classList.add('active');
				var target = btn.getAttribute('data-tab');
				self.activeTab = target;
				container.querySelectorAll('.taskman-panel').forEach(function(p) {
					p.classList.remove('active');
				});
				var activeP = container.querySelector('#panel-' + target);
				if (activeP) activeP.classList.add('active');

				if (target === 'proc') {
					self.renderProcessTable(self.lastProcesses || []);
				}
			});
		});

		// Quick Chips Click -> Switch tab/subtab
		container.querySelectorAll('.taskman-chip').forEach(function(chip) {
			chip.addEventListener('click', function() {
				var target = chip.getAttribute('data-target');
				if (target == 'cpu' || target == 'mem' || target == 'net' || target == 'disk') {
					container.querySelector('.taskman-tab-btn[data-tab="perf"]').click();
					var navItem = container.querySelector('.taskman-perf-nav-item[data-subtab="' + target + '"]');
					if (navItem) navItem.click();
				} else if (target == 'gpu') {
					container.querySelector('.taskman-tab-btn[data-tab="gpu"]').click();
				}
			});
		});

		// Performance Sub-Tabs Switching
		var perfNavItems = container.querySelectorAll('.taskman-perf-nav-item');
		perfNavItems.forEach(function(item) {
			item.addEventListener('click', function() {
				perfNavItems.forEach(function(i) { i.classList.remove('active'); });
				item.classList.add('active');
				var sub = item.getAttribute('data-subtab');
				self.activePerfSubTab = sub;
				container.querySelectorAll('[id^="subpanel-"]').forEach(function(sp) {
					sp.style.display = 'none';
				});
				var activeSubP = container.querySelector('#subpanel-' + sub);
				if (activeSubP) activeSubP.style.display = 'block';
			});
		});

		// Polling Interval Selector
		container.querySelectorAll('.taskman-interval-btn').forEach(function(btn) {
			btn.addEventListener('click', function() {
				container.querySelectorAll('.taskman-interval-btn').forEach(function(b) { b.classList.remove('active'); });
				btn.classList.add('active');
				var interval = parseInt(btn.getAttribute('data-interval'), 10);
				self.setPollingInterval(interval);
			});
		});

		// Process Search Filter
		var searchInput = container.querySelector('#proc-search-input');
		if (searchInput) {
			searchInput.addEventListener('input', function(e) {
				self.searchQuery = e.target.value.toLowerCase().trim();
				self.renderProcessTable(self.lastProcesses || []);
			});
		}

		// Process Sorting Headers
		container.querySelectorAll('.taskman-table th[data-sort]').forEach(function(th) {
			th.addEventListener('click', function() {
				var field = th.getAttribute('data-sort');
				if (self.sortField === field) {
					self.sortAsc = !self.sortAsc;
				} else {
					self.sortField = field;
					self.sortAsc = false;
				}
				self.renderProcessTable(self.lastProcesses || []);
			});
		});
	},

	setPollingInterval: function(interval) {
		this.pollInterval = interval;
		if (this.timerId) {
			clearInterval(this.timerId);
			this.timerId = null;
		}
		if (interval > 0) {
			this.startPoller();
		}
	},

	startPoller: function() {
		var self = this;
		if (this.pollInterval <= 0) return;
		this.timerId = setInterval(function() {
			Promise.all([
				callPerfStats(),
				callSystemInfo()
			]).then(function(res) {
				var stats = res[0] || {};
				var sys = res[1] || {};
				var procs = (stats.processes && Array.isArray(stats.processes) && stats.processes.length > 0) ?
					stats.processes : self.lastProcesses;
				self.updateAll(stats, procs, sys);
			}).catch(function(err) {
				console.error('Taskman poll error:', err);
			});
		}, this.pollInterval);
	},

	updateAll: function(stats, processes, sysInfo) {
		var now = Date.now();
		var timeDelta = (this.lastTimestamp > 0) ? (now - this.lastTimestamp) / 1000.0 : 1.0;
		if (timeDelta <= 0) timeDelta = 1.0;
		this.lastTimestamp = now;

		// 1. Calculate CPU Deltas
		var cpuTotalPct = 0;
		var coresPct = [0, 0, 0, 0, 0, 0];
		
		if (this.prevStats && this.prevStats.cpu && stats.cpu) {
			// Total CPU
			var curT = stats.cpu.total;
			var prevT = this.prevStats.cpu.total;
			if (curT && prevT) {
				var totalDiff = curT.total - prevT.total;
				var busyDiff = curT.busy - prevT.busy;
				if (totalDiff > 0) {
					cpuTotalPct = Math.max(0, Math.min(100, Math.round((busyDiff / totalDiff) * 100)));
				}
			}

			// Cores
			var curC = stats.cpu.cores || [];
			var prevC = this.prevStats.cpu.cores || [];
			for (var i = 0; i < Math.min(curC.length, 6); i++) {
				var cCur = curC[i];
				var cPrev = prevC[i];
				if (cCur && cPrev) {
					var cTotalDiff = cCur.total - cPrev.total;
					var cBusyDiff = cCur.busy - cPrev.busy;
					if (cTotalDiff > 0) {
						coresPct[i] = Math.max(0, Math.min(100, Math.round((cBusyDiff / cTotalDiff) * 100)));
					}
				}
			}
		}

		// Update CPU History
		this.pushHistory(this.history.cpuTotal, cpuTotalPct);
		for (var c = 0; c < 6; c++) {
			this.pushHistory(this.history.cpuCores[c], coresPct[c]);
		}

		// 2. Memory Calculations
		var mem = stats.mem || {};
		var memTotal = mem.MemTotal || (sysInfo.memory?.total || 1643737088);
		var memFree = mem.MemFree || (sysInfo.memory?.free || 0);
		var memAvail = mem.MemAvailable || (sysInfo.memory?.available || memFree);
		var memCached = mem.Cached || (sysInfo.memory?.cached || 0);
		var memBuffers = mem.Buffers || (sysInfo.memory?.buffered || 0);
		var memUsed = Math.max(0, memTotal - memAvail);
		var memUsedPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
		
		this.pushHistory(this.history.memUsedPct, memUsedPct);

		// 3. Network Calculations
		var rxTotalBytes = 0;
		var txTotalBytes = 0;
		var netList = stats.net || [];
		netList.forEach(function(iface) {
			rxTotalBytes += iface.rx_bytes || 0;
			txTotalBytes += iface.tx_bytes || 0;
		});

		var rxRate = 0;
		var txRate = 0;
		if (this.prevStats && this.prevStats._rxTotal !== undefined) {
			var rxDiff = rxTotalBytes - this.prevStats._rxTotal;
			var txDiff = txTotalBytes - this.prevStats._txTotal;
			rxRate = Math.max(0, Math.round(rxDiff / timeDelta));
			txRate = Math.max(0, Math.round(txDiff / timeDelta));
		}
		stats._rxTotal = rxTotalBytes;
		stats._txTotal = txTotalBytes;

		this.pushHistory(this.history.netRx, rxRate / 1024.0); // in KB/s
		this.pushHistory(this.history.netTx, txRate / 1024.0);

		// 4. Disk Calculations
		var diskList = stats.disks || [];
		var readBytesTotal = 0;
		var writeBytesTotal = 0;
		diskList.forEach(function(d) {
			readBytesTotal += d.read_bytes || 0;
			writeBytesTotal += d.write_bytes || 0;
		});

		var readRate = 0;
		var writeRate = 0;
		if (this.prevStats && this.prevStats._readTotal !== undefined) {
			readRate = Math.max(0, Math.round((readBytesTotal - this.prevStats._readTotal) / timeDelta));
			writeRate = Math.max(0, Math.round((writeBytesTotal - this.prevStats._writeTotal) / timeDelta));
		}
		stats._readTotal = readBytesTotal;
		stats._writeTotal = writeBytesTotal;

		this.pushHistory(this.history.diskRead, readRate / 1024.0);
		this.pushHistory(this.history.diskWrite, writeRate / 1024.0);

		// 5. Update UI DOM Elements
		this.updateDomValues({
			cpuPct: cpuTotalPct,
			coresPct: coresPct,
			freqs: stats.cpu_freqs || [],
			memTotal: memTotal,
			memUsed: memUsed,
			memAvail: memAvail,
			memFree: memFree,
			memCached: memCached,
			memBuffers: memBuffers,
			memPct: memUsedPct,
			thermal: stats.thermal,
			rxRate: rxRate,
			txRate: txRate,
			readRate: readRate,
			writeRate: writeRate,
			netList: netList,
			sysInfo: sysInfo,
			gpu: stats.gpu
		});

		// 6. Draw Charts
		this.drawAllCharts();

		// 7. Update Processes Table
		if (processes && processes.length > 0) {
			this.lastProcesses = processes;
		}
		if (this.activeTab === 'proc') {
			this.renderProcessTable(this.lastProcesses || []);
		}

		// Store previous state
		this.prevStats = stats;
		this.lastGpuStats = stats.gpu || null;
	},

	pushHistory: function(buf, val) {
		buf.push(val);
		if (buf.length > 60) buf.shift();
	},

	getEl: function(id) {
		if (this.containerNode) {
			var el = this.containerNode.querySelector('#' + id);
			if (el) return el;
		}
		return document.getElementById(id);
	},

	updateDomValues: function(d) {
		// Quick Chips
		var cpuChip = this.getEl('chip-cpu-val');
		if (cpuChip) cpuChip.textContent = d.cpuPct + '%';
		
		var curFreqMhz = (d.freqs[0]?.cur_khz) ? (d.freqs[0].cur_khz / 1000).toFixed(0) : '1700';
		var cpuFreq = this.getEl('chip-cpu-freq');
		if (cpuFreq) cpuFreq.textContent = (curFreqMhz / 1000).toFixed(2) + ' GHz (6 Cores)';

		var memChip = this.getEl('chip-mem-val');
		if (memChip) memChip.textContent = d.memPct + '%';
		var memSub = this.getEl('chip-mem-sub');
		if (memSub) memSub.textContent = (d.memUsed / (1024*1024)).toFixed(0) + ' / ' + (d.memTotal / (1024*1024)).toFixed(0) + ' MB';

		var tempChip = this.getEl('chip-temp-val');
		if (tempChip && d.thermal) {
			tempChip.textContent = d.thermal.celsius.toFixed(1) + '°C';
		}

		var netChip = this.getEl('chip-net-val');
		if (netChip) netChip.textContent = '↓ ' + this.formatSpeed(d.rxRate);
		var netSub = this.getEl('chip-net-sub');
		if (netSub) netSub.textContent = '↑ ' + this.formatSpeed(d.txRate);

		// Performance Left Nav
		var navCpu = this.getEl('perf-nav-cpu-val');
		if (navCpu) navCpu.textContent = d.cpuPct + '%';
		var navMem = this.getEl('perf-nav-mem-val');
		if (navMem) navMem.textContent = d.memPct + '%';
		var navNet = this.getEl('perf-nav-net-val');
		if (navNet) navNet.textContent = this.formatSpeed(d.rxRate);
		var navDisk = this.getEl('perf-nav-disk-val');
		if (navDisk) navDisk.textContent = this.formatSpeed(d.writeRate);

		// CPU Detail
		var cpuMain = this.getEl('cpu-main-label');
		if (cpuMain) cpuMain.textContent = d.cpuPct + '%';

		// Individual Core Values
		for (var i = 0; i < 6; i++) {
			var coreVal = this.getEl('core-val-' + i);
			if (coreVal) coreVal.textContent = (d.coresPct[i] || 0) + '%';
			var coreFreq = this.getEl('core-freq-' + i);
			if (coreFreq && d.freqs[i]) {
				coreFreq.textContent = ((d.freqs[i].cur_khz || 1700000) / 1000000).toFixed(2) + ' GHz';
			}
		}

		// Memory Detail
		var memMain = this.getEl('mem-main-label');
		if (memMain) memMain.textContent = (d.memUsed / (1024*1024)).toFixed(0) + ' MB (' + d.memPct + '%)';

		var barUsed = this.getEl('mem-bar-used');
		if (barUsed) barUsed.style.width = d.memPct + '%';
		var barCached = this.getEl('mem-bar-cached');
		if (barCached) barCached.style.width = Math.round((d.memCached / d.memTotal) * 100) + '%';
		var barFree = this.getEl('mem-bar-free');
		if (barFree) barFree.style.width = Math.round((d.memFree / d.memTotal) * 100) + '%';

		var memGrid = this.getEl('mem-details-grid');
		if (memGrid && !memGrid.hasChildNodes()) {
			memGrid.innerHTML = `
				<div class="taskman-core-box"><strong>Total RAM:</strong> ${(d.memTotal/(1024*1024)).toFixed(0)} MB</div>
				<div class="taskman-core-box"><strong>In Use:</strong> ${(d.memUsed/(1024*1024)).toFixed(0)} MB</div>
				<div class="taskman-core-box"><strong>Available:</strong> ${(d.memAvail/(1024*1024)).toFixed(0)} MB</div>
				<div class="taskman-core-box"><strong>Free:</strong> ${(d.memFree/(1024*1024)).toFixed(0)} MB</div>
				<div class="taskman-core-box"><strong>Cached:</strong> ${(d.memCached/(1024*1024)).toFixed(0)} MB</div>
				<div class="taskman-core-box"><strong>Buffers:</strong> ${(d.memBuffers/(1024*1024)).toFixed(1)} MB</div>
			`;
		}

		// Network Detail
		var netMain = this.getEl('net-main-label');
		if (netMain) netMain.textContent = '↓ ' + this.formatSpeed(d.rxRate) + '  ↑ ' + this.formatSpeed(d.txRate);

		var netTableBox = this.getEl('net-interfaces-table-box');
		if (netTableBox) {
			var rows = '';
			d.netList.forEach(function(n) {
				rows += `<tr>
					<td style="font-weight:600;">${n.ifname}</td>
					<td>${(n.rx_bytes / (1024*1024)).toFixed(1)} MB</td>
					<td>${(n.tx_bytes / (1024*1024)).toFixed(1)} MB</td>
					<td>${n.rx_packets}</td>
					<td>${n.tx_packets}</td>
				</tr>`;
			});
			netTableBox.innerHTML = `
				<table class="taskman-table">
					<thead>
						<tr><th>Interface</th><th>Received (RX)</th><th>Sent (TX)</th><th>RX Packets</th><th>TX Packets</th></tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			`;
		}

		// Disk Detail
		var diskMain = this.getEl('disk-main-label');
		if (diskMain) diskMain.textContent = 'R: ' + this.formatSpeed(d.readRate) + '  W: ' + this.formatSpeed(d.writeRate);

		// System Details
		var sysUptime = this.getEl('sys-detail-uptime');
		if (sysUptime && d.sysInfo.uptime) {
			sysUptime.textContent = this.formatUptime(d.sysInfo.uptime);
		}
		var sysLoad = this.getEl('sys-detail-load');
		if (sysLoad && d.sysInfo.load) {
			sysLoad.textContent = (d.sysInfo.load[0]/65536).toFixed(2) + ', ' + (d.sysInfo.load[1]/65536).toFixed(2) + ', ' + (d.sysInfo.load[2]/65536).toFixed(2);
		}

		// GPU & fbstreamer Detail
		var fbActive = d.gpu && d.gpu.fbstreamer_active;
		var fbEnabled = d.gpu && d.gpu.fbstreamer_enabled;
		
		var gpuChipVal = this.getEl('chip-gpu-val');
		if (gpuChipVal) gpuChipVal.textContent = fbActive ? 'Stream ON' : 'Stream OFF';
		var gpuChipSub = this.getEl('chip-gpu-sub');
		if (gpuChipSub) gpuChipSub.textContent = fbActive ? 'Port 9999 (1080p)' : 'HDMI Local Only';
		var gpuChipInd = this.getEl('chip-gpu-ind');
		if (gpuChipInd) {
			gpuChipInd.style.background = fbActive ? '#10b981' : '#94a3b8';
			gpuChipInd.className = 'taskman-chip-indicator' + (fbActive ? ' pulse' : '');
		}
		
		var fbBadge = this.getEl('fbstreamer-status-badge');
		if (fbBadge) {
			fbBadge.className = 'taskman-status-badge ' + (fbActive ? 'taskman-status-running' : 'taskman-status-sleeping');
			fbBadge.textContent = fbActive ? _('Running (Port 9999)') : _('Stopped (Offline)');
		}
		var fbMem = this.getEl('fbstreamer-mem-vsz');
		if (fbMem) {
			fbMem.textContent = fbActive ? '~378 MB Virtual RAM (High)' : '0 MB (Freed)';
			fbMem.style.color = fbActive ? '#f59e0b' : '#10b981';
		}
		var fbAuto = this.getEl('fbstreamer-autostart');
		if (fbAuto) fbAuto.textContent = fbEnabled ? _('Enabled (Auto-starts on boot)') : _('Disabled (Will not start on boot)');
		var fbUrl = this.getEl('fbstreamer-url');
		if (fbUrl) {
			if (fbActive) {
				fbUrl.innerHTML = '<a href="http://192.168.1.1:9999" target="_blank" style="color:var(--main-color, #0e7490); font-weight:700; text-decoration:underline;">http://192.168.1.1:9999 ↗</a>';
			} else {
				fbUrl.textContent = _('Service Offline (Port 9999 closed)');
			}
		}
		var fbBtn = this.getEl('fbstreamer-toggle-btn');
		if (fbBtn) {
			if (fbActive) {
				fbBtn.className = 'btn cbi-button-negative';
				fbBtn.textContent = '⏹️ ' + _('Turn OFF Streamer (Free ~380 MB RAM)');
			} else {
				fbBtn.className = 'btn cbi-button-action';
				fbBtn.textContent = '▶️ ' + _('Turn ON Streamer (Start Port 9999)');
			}
		}
	},

	drawAllCharts: function() {
		// 1. Main CPU Total
		this.drawChart('chart-cpu-total', [
			{ data: this.history.cpuTotal, color: '#0284c7', fillColor: 'rgba(2, 132, 199, 0.18)' }
		], 100);

		// 2. Individual Cores
		for (var c = 0; c < 6; c++) {
			this.drawChart('chart-core-' + c, [
				{ data: this.history.cpuCores[c], color: '#0ea5e9', fillColor: 'rgba(14, 165, 233, 0.15)' }
			], 100);
		}

		// 3. Memory
		this.drawChart('chart-mem-total', [
			{ data: this.history.memUsedPct, color: '#0e7490', fillColor: 'rgba(14, 116, 144, 0.18)' }
		], 100);

		// 4. Network (Dual line: RX in green, TX in purple)
		var maxNet = 100;
		var allNet = this.history.netRx.concat(this.history.netTx);
		allNet.forEach(function(v) { if (v > maxNet) maxNet = v; });
		this.drawChart('chart-net-total', [
			{ data: this.history.netRx, color: '#10b981', fillColor: 'rgba(16, 185, 129, 0.12)' },
			{ data: this.history.netTx, color: '#a855f7', fillColor: 'rgba(168, 85, 247, 0.12)' }
		], maxNet);

		// 5. Disk
		var maxDisk = 100;
		var allDisk = this.history.diskRead.concat(this.history.diskWrite);
		allDisk.forEach(function(v) { if (v > maxDisk) maxDisk = v; });
		this.drawChart('chart-disk-total', [
			{ data: this.history.diskWrite, color: '#f59e0b', fillColor: 'rgba(245, 158, 11, 0.12)' },
			{ data: this.history.diskRead, color: '#3b82f6', fillColor: 'rgba(59, 130, 246, 0.12)' }
		], maxDisk);
	},

	drawChart: function(canvasId, seriesList, maxVal) {
		var canvas = this.getEl(canvasId);
		if (!canvas) return;
		var ctx = canvas.getContext('2d');
		if (!ctx) return;

		var rect = canvas.getBoundingClientRect();
		var dpr = window.devicePixelRatio || 1;
		var w = rect.width || canvas.parentElement?.clientWidth || 200;
		var h = rect.height || 60;

		if (w === 0 || h === 0) return;

		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}

		ctx.save();
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);

		// Draw Horizontal Gridlines
		ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);

		for (var i = 1; i < 4; i++) {
			var y = (h / 4) * i;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
			ctx.stroke();
		}
		ctx.setLineDash([]);

		// Draw Series
		seriesList.forEach(function(s) {
			var pts = s.data || [];
			if (pts.length < 2) return;

			var step = w / 59;
			var startX = w - (pts.length - 1) * step;

			ctx.beginPath();
			for (var p = 0; p < pts.length; p++) {
				var x = startX + p * step;
				var val = pts[p];
				var y = h - ((val / maxVal) * (h - 4)) - 2;
				if (y < 2) y = 2;
				if (y > h - 2) y = h - 2;

				if (p === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}

			// Fill Area
			if (s.fillColor) {
				ctx.save();
				ctx.lineTo(w, h);
				ctx.lineTo(startX, h);
				ctx.closePath();
				ctx.fillStyle = s.fillColor;
				ctx.fill();
				ctx.restore();
			}

			// Stroke Line
			ctx.strokeStyle = s.color;
			ctx.lineWidth = 1.75;
			ctx.stroke();
		});

		ctx.restore();
	},

	renderProcessTable: function(processes) {
		var tbody = this.getEl('proc-table-tbody');
		if (!tbody) return;

		var filter = this.searchQuery;
		var filtered = (processes || []).filter(function(p) {
			if (!filter) return true;
			var name = (p.COMMAND || '').toLowerCase();
			var pid = String(p.PID);
			var user = (p.USER || '').toLowerCase();
			return name.includes(filter) || pid.includes(filter) || user.includes(filter);
		});

		var sortField = this.sortField;
		var sortAsc = this.sortAsc;

		filtered.sort(function(a, b) {
			var valA, valB;
			if (sortField === 'pid') {
				valA = parseInt(a.PID, 10) || 0;
				valB = parseInt(b.PID, 10) || 0;
			} else if (sortField === 'cpu') {
				valA = parseFloat(a['%CPU']) || 0;
				valB = parseFloat(b['%CPU']) || 0;
			} else if (sortField === 'mem') {
				valA = parseFloat(a['%MEM']) || 0;
				valB = parseFloat(b['%MEM']) || 0;
			} else if (sortField === 'vsz') {
				valA = parseInt(a.VSZ, 10) || 0;
				valB = parseInt(b.VSZ, 10) || 0;
			} else if (sortField === 'user') {
				valA = a.USER || '';
				valB = b.USER || '';
			} else {
				valA = a.COMMAND || '';
				valB = b.COMMAND || '';
			}

			if (valA < valB) return sortAsc ? -1 : 1;
			if (valA > valB) return sortAsc ? 1 : -1;
			return 0;
		});

		var summary = this.getEl('proc-stats-summary');
		if (summary) {
			summary.textContent = sprintf(_('Showing %d of %d processes'), filtered.length, processes.length);
		}

		tbody.innerHTML = '';
		var self = this;

		filtered.forEach(function(p) {
			var cpuNum = parseFloat(p['%CPU']) || 0;
			var memNum = parseFloat(p['%MEM']) || 0;
			var isRunning = (p.STAT || '').includes('R');
			var cmd = p.COMMAND || 'unknown';
			var parts = cmd.split(' ');
			var baseName = parts[0].split('/').pop() || cmd;

			var tr = E('tr', {}, [
				E('td', { 'style': 'max-width:320px;' }, [
					E('div', { 'style': 'font-weight:700; color:var(--text-primary); font-size:13px;' }, baseName),
					E('div', { 'style': 'font-size:11px; color:var(--text-muted); word-break:break-all; margin-top:2px;' }, cmd)
				]),
				E('td', { 'style': 'font-family:monospace; font-weight:600; color:var(--text-muted);' }, p.PID),
				E('td', {}, p.USER || 'root'),
				E('td', {}, [
					E('span', {
						'class': 'taskman-status-badge ' + (isRunning ? 'taskman-status-running' : 'taskman-status-sleeping')
					}, isRunning ? 'Running' : 'Sleep')
				]),
				E('td', {}, [
					E('span', { 'style': 'display:inline-block; width:38px; font-weight:600;' }, cpuNum.toFixed(1) + '%'),
					E('div', { 'class': 'taskman-progress-bar-bg' }, [
						E('div', { 'class': 'taskman-progress-bar-fill', 'style': 'width:' + Math.min(100, cpuNum * 2) + '%;' })
					])
				]),
				E('td', {}, [
					E('span', { 'style': 'display:inline-block; width:38px; font-weight:600;' }, memNum.toFixed(1) + '%'),
					E('div', { 'class': 'taskman-progress-bar-bg' }, [
						E('div', { 'class': 'taskman-progress-bar-fill', 'style': 'width:' + Math.min(100, memNum) + '%; background:#0e7490;' })
					])
				]),
				E('td', { 'style': 'font-family:monospace; color:var(--text-muted); font-size:11px;' }, p.VSZ || '--'),
				E('td', { 'style': 'text-align:right;' }, [
					E('button', {
						'class': 'taskman-end-btn',
						'click': function() { self.showEndTaskModal(p); }
					}, '✕ ' + _('End Task'))
				])
			]);
			tbody.appendChild(tr);
		});
	},

	showEndTaskModal: function(proc) {
		var self = this;
		var modalOverlay = E('div', { 'class': 'taskman-modal-overlay' });
		var modal = E('div', { 'class': 'taskman-modal' }, [
			E('h3', { 'style': 'margin-top:0; color:#ef4444; display:flex; align-items:center; gap:8px;' }, [
				'⚠️', _('End Process Task?')
			]),
			E('p', { 'style': 'font-size:13px; color:var(--text-secondary); line-height:1.5;' }, [
				_('Are you sure you want to stop process:'), ' ',
				E('strong', {}, proc.COMMAND), ' ',
				'(PID: ' + proc.PID + ')?'
			]),
			(proc.PID == 1 || proc.COMMAND.includes('procd') || proc.COMMAND.includes('ubus')) ?
				E('div', { 'style': 'background:#fee2e2; color:#b91c1c; padding:8px 12px; border-radius:6px; font-size:11px; margin-bottom:12px;' },
					_('Warning: This is a critical system service. Terminating it may reboot the router!')) : E('span'),
			E('div', { 'style': 'display:flex; justify-content:flex-end; gap:8px; margin-top:1.25rem;' }, [
				E('button', {
					'class': 'btn',
					'click': function() { document.body.removeChild(modalOverlay); }
				}, _('Cancel')),
				E('button', {
					'class': 'btn cbi-button-action',
					'click': function() {
						document.body.removeChild(modalOverlay);
						self.terminateProcess(proc.PID, 15, proc.COMMAND);
					}
				}, _('Terminate (SIGTERM)')),
				E('button', {
					'class': 'btn cbi-button-negative',
					'click': function() {
						document.body.removeChild(modalOverlay);
						self.terminateProcess(proc.PID, 9, proc.COMMAND);
					}
				}, _('Force Kill (SIGKILL)'))
			])
		]);
		modalOverlay.appendChild(modal);
		document.body.appendChild(modalOverlay);
	},

	terminateProcess: function(pid, signal, name) {
		var self = this;
		callKillProcess(pid, signal).then(function(res) {
			if (res && res.success) {
				ui.addNotification(null, E('p', sprintf(_('Process %s (PID: %d) stopped successfully.'), name, pid)), 'info');
				// Immediate refresh
				callProcessList().then(function(pl) {
					self.renderProcessTable(extractProcesses(pl));
				});
			} else {
				ui.addNotification(null, E('p', sprintf(_('Failed to stop process %s (PID: %d): %s'), name, pid, res?.error || 'Access denied')), 'error');
			}
		}).catch(function(e) {
			ui.addNotification(null, E('p', e.message), 'error');
		});
	},

	formatSpeed: function(bytesPerSec) {
		if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
		if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
		return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
	},

	formatUptime: function(seconds) {
		var d = Math.floor(seconds / 86400);
		var h = Math.floor((seconds % 86400) / 3600);
		var m = Math.floor((seconds % 3600) / 60);
		var s = Math.floor(seconds % 60);
		var parts = [];
		if (d > 0) parts.push(d + 'd');
		if (h > 0) parts.push(h + 'h');
		if (m > 0) parts.push(m + 'm');
		parts.push(s + 's');
		return parts.join(' ');
	},

	toggleFbstreamerAction: function() {
		var self = this;
		var isCurrentlyActive = this.lastGpuStats && this.lastGpuStats.fbstreamer_active;
		var targetState = !isCurrentlyActive;
		
		var btn = this.getEl('fbstreamer-toggle-btn');
		if (btn) {
			btn.disabled = true;
			btn.textContent = _('Applying...');
		}
		
		callToggleFbstreamer(targetState).then(function(res) {
			if (btn) btn.disabled = false;
			if (res && res.success) {
				if (targetState) {
					ui.addNotification(null, E('p', _('HDMI Video Streamer (Port 9999) has been STARTED and enabled.')), 'info');
				} else {
					ui.addNotification(null, E('p', _('HDMI Video Streamer has been STOPPED. ~380 MB of RAM freed!')), 'info');
				}
				// Immediate refresh
				callPerfStats().then(function(s) {
					self.updateAll(s || {}, s?.processes || [], {});
				});
			} else {
				ui.addNotification(null, E('p', _('Failed to change fbstreamer service state.')), 'error');
			}
		}).catch(function(e) {
			if (btn) btn.disabled = false;
			ui.addNotification(null, E('p', e.message), 'error');
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
