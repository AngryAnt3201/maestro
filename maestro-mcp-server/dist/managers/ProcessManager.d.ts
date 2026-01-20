import type { ManagedProcess, StartServerOptions, ServerStatus } from '../types.js';
import { PortManager } from './PortManager.js';
import { LogManager } from './LogManager.js';
/**
 * Manages dev server processes.
 * Handles starting, stopping, and monitoring of processes.
 */
export declare class ProcessManager {
    private processes;
    private childProcesses;
    private portManager;
    private logManager;
    private cleanupInterval;
    constructor(portManager: PortManager, logManager: LogManager);
    /**
     * Load existing status from file on startup to recover port assignments.
     */
    private loadStatusFromFile;
    /**
     * Clean up stale process entries that have been stopped for too long.
     */
    private cleanupStaleProcesses;
    /**
     * Start a dev server for a session.
     */
    startProcess(options: StartServerOptions): Promise<ManagedProcess>;
    /**
     * Stop a running process.
     */
    stopProcess(sessionId: number): Promise<void>;
    /**
     * Restart a process.
     */
    restartProcess(sessionId: number): Promise<ManagedProcess>;
    /**
     * Get status of a process.
     */
    getStatus(sessionId: number): ServerStatus | null;
    /**
     * Get status of all processes.
     */
    getAllStatuses(): ServerStatus[];
    /**
     * Check if a session has a running process.
     */
    isRunning(sessionId: number): boolean;
    /**
     * Detect server URL from output.
     */
    private detectServerUrl;
    /**
     * Get path to the status file for IPC with Swift app.
     */
    private getStatusFilePath;
    /**
     * Write current server statuses to file for Swift app to read.
     * Uses atomic file write (write to temp file, then rename) to prevent
     * the Swift file watcher from reading partially-written files.
     */
    private writeStatusFile;
    /**
     * Cleanup all processes (for shutdown).
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=ProcessManager.d.ts.map