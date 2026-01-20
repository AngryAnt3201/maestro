/**
 * Manages port allocation for dev servers.
 * Allocates ports in the 3000-3099 range.
 */
export declare class PortManager {
    private readonly basePort;
    private readonly maxPort;
    private assignedPorts;
    constructor(basePort?: number, maxPort?: number);
    /**
     * Assign an available port to a session.
     * Returns the assigned port or throws if no ports available.
     */
    assignPort(sessionId: number, preferredPort?: number): Promise<number>;
    /**
     * Release a port assigned to a session.
     */
    releasePort(sessionId: number): void;
    /**
     * Mark a port as in use by a session (for recovery on startup).
     * This is used when loading existing status from file to restore port assignments.
     */
    markPortInUse(sessionId: number, port: number): void;
    /**
     * Get the port assigned to a session.
     */
    getPort(sessionId: number): number | undefined;
    /**
     * Check if a port is available (not in use).
     */
    isPortAvailable(port: number): Promise<boolean>;
    /**
     * Get a list of available ports.
     */
    getAvailablePorts(count?: number): Promise<number[]>;
    /**
     * Get all current port assignments.
     */
    getAllAssignments(): Map<number, number>;
}
//# sourceMappingURL=PortManager.d.ts.map