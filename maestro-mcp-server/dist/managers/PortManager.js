import * as net from 'net';
/**
 * Manages port allocation for dev servers.
 * Allocates ports in the 3000-3099 range.
 */
export class PortManager {
    basePort;
    maxPort;
    assignedPorts = new Map(); // sessionId -> port
    constructor(basePort = 3000, maxPort = 3099) {
        this.basePort = basePort;
        this.maxPort = maxPort;
    }
    /**
     * Assign an available port to a session.
     * Returns the assigned port or throws if no ports available.
     */
    async assignPort(sessionId, preferredPort) {
        // If session already has a port, return it
        const existing = this.assignedPorts.get(sessionId);
        if (existing !== undefined) {
            return existing;
        }
        // Try preferred port first if specified
        if (preferredPort !== undefined) {
            if (await this.isPortAvailable(preferredPort)) {
                this.assignedPorts.set(sessionId, preferredPort);
                return preferredPort;
            }
        }
        // Find an available port
        for (let port = this.basePort; port <= this.maxPort; port++) {
            // Skip if already assigned to another session
            const assignedValues = Array.from(this.assignedPorts.values());
            if (assignedValues.includes(port)) {
                continue;
            }
            if (await this.isPortAvailable(port)) {
                this.assignedPorts.set(sessionId, port);
                return port;
            }
        }
        throw new Error(`No available ports in range ${this.basePort}-${this.maxPort}`);
    }
    /**
     * Release a port assigned to a session.
     */
    releasePort(sessionId) {
        this.assignedPorts.delete(sessionId);
    }
    /**
     * Mark a port as in use by a session (for recovery on startup).
     * This is used when loading existing status from file to restore port assignments.
     */
    markPortInUse(sessionId, port) {
        this.assignedPorts.set(sessionId, port);
    }
    /**
     * Get the port assigned to a session.
     */
    getPort(sessionId) {
        return this.assignedPorts.get(sessionId);
    }
    /**
     * Check if a port is available (not in use).
     */
    async isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => {
                resolve(false);
            });
            server.once('listening', () => {
                server.close(() => {
                    resolve(true);
                });
            });
            server.listen(port, '127.0.0.1');
        });
    }
    /**
     * Get a list of available ports.
     */
    async getAvailablePorts(count = 5) {
        const available = [];
        const assignedValues = Array.from(this.assignedPorts.values());
        for (let port = this.basePort; port <= this.maxPort && available.length < count; port++) {
            if (assignedValues.includes(port)) {
                continue;
            }
            if (await this.isPortAvailable(port)) {
                available.push(port);
            }
        }
        return available;
    }
    /**
     * Get all current port assignments.
     */
    getAllAssignments() {
        return new Map(this.assignedPorts);
    }
}
//# sourceMappingURL=PortManager.js.map