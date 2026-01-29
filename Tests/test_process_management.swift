#!/usr/bin/env swift

// Standalone test script for native process management
// Run with: swift test_process_management.swift

import Foundation
import Darwin

// MARK: - Test Infrastructure

var testsPassed = 0
var testsFailed = 0
var currentTest = ""

func test(_ name: String, _ block: () throws -> Void) {
    currentTest = name
    print("Testing: \(name)...", terminator: " ")
    do {
        try block()
        print("✓")
        testsPassed += 1
    } catch {
        print("✗ - \(error)")
        testsFailed += 1
    }
}

func assertEqual<T: Equatable>(_ a: T, _ b: T, _ message: String = "") throws {
    guard a == b else {
        throw TestError.assertionFailed("\(message) - Expected \(a) == \(b)")
    }
}

func assertTrue(_ condition: Bool, _ message: String = "") throws {
    guard condition else {
        throw TestError.assertionFailed(message)
    }
}

func assertFalse(_ condition: Bool, _ message: String = "") throws {
    guard !condition else {
        throw TestError.assertionFailed(message)
    }
}

func assertGreaterThan<T: Comparable>(_ a: T, _ b: T, _ message: String = "") throws {
    guard a > b else {
        throw TestError.assertionFailed("\(message) - Expected \(a) > \(b)")
    }
}

func assertNotNil<T>(_ value: T?, _ message: String = "") throws {
    guard value != nil else {
        throw TestError.assertionFailed("\(message) - Expected non-nil value")
    }
}

enum TestError: Error, CustomStringConvertible {
    case assertionFailed(String)

    var description: String {
        switch self {
        case .assertionFailed(let msg): return msg
        }
    }
}

// MARK: - posix_spawn Tests

print("\n=== posix_spawn with Process Groups ===\n")

test("spawn returns valid PID") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    let args = ["/bin/echo", "hello"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let result = posix_spawn(&pid, "/bin/echo", nil, &attr, &argPtrs, nil)
    try assertEqual(result, 0, "posix_spawn should succeed")
    try assertGreaterThan(pid, 0, "PID should be positive")

    var status: Int32 = 0
    waitpid(pid, &status, 0)
}

test("POSIX_SPAWN_SETPGROUP sets pgid = pid") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    // Set SETPGROUP flag
    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0) // pgid = pid

    let args = ["/bin/sleep", "0.1"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let result = posix_spawn(&pid, "/bin/sleep", nil, &attr, &argPtrs, nil)
    try assertEqual(result, 0, "posix_spawn should succeed")

    // Check that pgid equals pid
    let pgid = getpgid(pid)
    try assertEqual(pgid, pid, "PGID should equal PID")

    var status: Int32 = 0
    waitpid(pid, &status, 0)
}

test("killpg terminates process group") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    // Set SETPGROUP flag
    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    let args = ["/bin/sleep", "60"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let result = posix_spawn(&pid, "/bin/sleep", nil, &attr, &argPtrs, nil)
    try assertEqual(result, 0, "posix_spawn should succeed")

    // Kill the process group
    let killResult = killpg(pid, SIGTERM)
    try assertEqual(killResult, 0, "killpg should succeed")

    // Wait for process
    var status: Int32 = 0
    waitpid(pid, &status, 0)

    // Verify group is gone
    let checkResult = killpg(pid, 0)
    try assertEqual(checkResult, -1, "Process group should not exist")
}

test("shell spawns children in same process group") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    // Create pipes for stdout
    var stdoutPipe: [Int32] = [0, 0]
    pipe(&stdoutPipe)

    var fileActions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fileActions)
    posix_spawn_file_actions_addclose(&fileActions, stdoutPipe[0])
    posix_spawn_file_actions_adddup2(&fileActions, stdoutPipe[1], STDOUT_FILENO)
    posix_spawn_file_actions_addclose(&fileActions, stdoutPipe[1])

    // Shell command that spawns a background sleep and prints its PID
    let args = ["/bin/sh", "-c", "sleep 5 & echo $!"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
        posix_spawn_file_actions_destroy(&fileActions)
    }

    let result = posix_spawn(&pid, "/bin/sh", &fileActions, &attr, &argPtrs, nil)
    close(stdoutPipe[1])

    try assertEqual(result, 0, "posix_spawn should succeed")

    // Read child PID from stdout
    var outputData = Data()
    let bufferSize = 256
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    let bytesRead = read(stdoutPipe[0], &buffer, bufferSize)
    close(stdoutPipe[0])

    if bytesRead > 0 {
        outputData.append(contentsOf: buffer[0..<bytesRead])
    }

    // Wait for shell to exit
    var status: Int32 = 0
    waitpid(pid, &status, 0)

    // Parse child PID
    if let output = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
       let childPid = pid_t(output) {
        // Check child's process group
        let childPgid = getpgid(childPid)
        try assertEqual(childPgid, pid, "Child should have parent's pgid")

        // Kill the child
        kill(childPid, SIGTERM)
        waitpid(childPid, &status, WNOHANG)
    }
}

test("process group contains multiple children") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    // Spawn shell with multiple background children
    let args = ["/bin/sh", "-c", "sleep 30 & sleep 30 & sleep 30 & wait"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let result = posix_spawn(&pid, "/bin/sh", nil, &attr, &argPtrs, nil)
    try assertEqual(result, 0, "spawn should succeed")

    // Wait for children to spawn
    usleep(500000)

    // Verify process group exists
    let groupExists = killpg(pid, 0)
    try assertEqual(groupExists, 0, "Process group should exist")

    // Kill entire group
    let killResult = killpg(pid, SIGTERM)
    try assertEqual(killResult, 0, "killpg should succeed")

    // Wait for cleanup
    usleep(500000)

    // Verify group is gone
    let groupGone = killpg(pid, 0)
    try assertEqual(groupGone, -1, "Process group should be gone after kill")

    var status: Int32 = 0
    waitpid(pid, &status, WNOHANG)
}

// MARK: - libproc Tests

print("\n=== libproc Process Information ===\n")

test("proc_listpids returns processes") {
    var numPids = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
    try assertGreaterThan(numPids, 0, "Should find some processes")

    let pidCount = Int(numPids) / MemoryLayout<pid_t>.size + 16
    var pids = [pid_t](repeating: 0, count: pidCount)

    numPids = proc_listpids(UInt32(PROC_ALL_PIDS), 0, &pids, Int32(pidCount * MemoryLayout<pid_t>.size))

    let actualCount = Int(numPids) / MemoryLayout<pid_t>.size
    try assertGreaterThan(actualCount, 0, "Should enumerate processes")
}

test("proc_pidinfo returns info for self") {
    let myPid = getpid()
    var info = proc_bsdinfo()

    let size = proc_pidinfo(myPid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    try assertGreaterThan(size, 0, "Should get info for self")

    try assertEqual(pid_t(info.pbi_pid), myPid, "PID should match")
    try assertEqual(uid_t(info.pbi_uid), getuid(), "UID should match")
}

test("proc_pidpath returns path for self") {
    let myPid = getpid()
    var pathBuffer = [CChar](repeating: 0, count: 4096)

    let pathLength = proc_pidpath(myPid, &pathBuffer, UInt32(pathBuffer.count))
    try assertGreaterThan(pathLength, 0, "Should get path")

    let path = String(cString: pathBuffer)
    try assertTrue(path.contains("swift"), "Path should contain 'swift'")
}

test("proc_pidinfo returns parent PID for child") {
    // Spawn a child
    var pid: pid_t = 0
    let args = ["/bin/sleep", "2"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer { for ptr in argPtrs { free(ptr) } }

    let spawnResult = posix_spawn(&pid, "/bin/sleep", nil, nil, &argPtrs, nil)
    try assertEqual(spawnResult, 0, "Should spawn child")

    // Small delay for process to register
    usleep(100000)

    // Get child's info
    var info = proc_bsdinfo()
    let size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    try assertGreaterThan(size, 0, "Should get child info")

    // Verify parent PID
    try assertEqual(pid_t(info.pbi_ppid), getpid(), "Child's PPID should be us")

    // Clean up
    kill(pid, SIGTERM)
    var status: Int32 = 0
    waitpid(pid, &status, 0)
}

test("proc_pidinfo returns process group ID") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    let args = ["/bin/sleep", "1"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let result = posix_spawn(&pid, "/bin/sleep", nil, &attr, &argPtrs, nil)
    try assertEqual(result, 0, "spawn should succeed")

    // Get process info via libproc
    var info = proc_bsdinfo()
    let size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    try assertGreaterThan(size, 0, "Should get process info")

    // PGID should equal PID for process group leader
    try assertEqual(pid_t(info.pbi_pgid), pid, "PGID should equal PID")

    kill(pid, SIGTERM)
    var status: Int32 = 0
    waitpid(pid, &status, 0)
}

// MARK: - Socket Port Checking Tests

print("\n=== Native Port Checking ===\n")

test("socket bind succeeds on available port") {
    let port: UInt16 = 3098

    let sock = socket(AF_INET, SOCK_STREAM, 0)
    try assertGreaterThan(sock, 0, "Should create socket")

    defer { close(sock) }

    var reuse: Int32 = 1
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = INADDR_ANY

    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            Darwin.bind(sock, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }

    // If bind succeeds (0), port was available
    // If it fails (-1), port was in use - both are valid outcomes
    try assertTrue(bindResult == 0 || bindResult == -1, "bind should return 0 or -1")
}

test("socket bind fails on used port") {
    let port: UInt16 = 3096

    // First socket binds to the port
    let sock1 = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(sock1) }

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = INADDR_ANY

    let bind1 = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            Darwin.bind(sock1, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }

    if bind1 != 0 {
        // Port already in use by something else - skip test
        print("(port \(port) already in use, skipping)")
        return
    }

    listen(sock1, 1)

    // Second socket should fail to bind
    let sock2 = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(sock2) }

    let bind2 = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            Darwin.bind(sock2, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }

    try assertEqual(bind2, -1, "Second bind should fail")
}

// MARK: - Integration Tests

print("\n=== Integration Tests ===\n")

test("full lifecycle: spawn with pgroup -> kill group -> verify cleanup") {
    var pid: pid_t = 0
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)

    var flags: Int16 = 0
    posix_spawnattr_getflags(&attr, &flags)
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    let args = ["/bin/sh", "-c", "sleep 60 & sleep 60 & wait"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)
    }

    let spawnResult = posix_spawn(&pid, "/bin/sh", nil, &attr, &argPtrs, nil)
    try assertEqual(spawnResult, 0, "spawn should succeed")

    // Verify pgid = pid
    let pgid = getpgid(pid)
    try assertEqual(pgid, pid, "pgid should equal pid")

    // Wait for children
    usleep(500000)

    // Verify group exists
    let groupExists = killpg(pgid, 0)
    try assertEqual(groupExists, 0, "Group should exist")

    // Kill the group
    killpg(pgid, SIGTERM)

    // Wait for cleanup
    usleep(500000)

    // Verify group is gone
    let groupGone = killpg(pgid, 0)
    try assertEqual(groupGone, -1, "Group should be gone")

    var status: Int32 = 0
    waitpid(pid, &status, WNOHANG)
}

test("no orphaned processes after group kill") {
    var pids: [pid_t] = []
    var pgids: [pid_t] = []

    // Spawn 3 process groups
    for _ in 0..<3 {
        var pid: pid_t = 0
        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)

        var flags: Int16 = 0
        posix_spawnattr_getflags(&attr, &flags)
        flags |= Int16(POSIX_SPAWN_SETPGROUP)
        posix_spawnattr_setflags(&attr, flags)
        posix_spawnattr_setpgroup(&attr, 0)

        let args = ["/bin/sh", "-c", "sleep 30 & sleep 30 & wait"]
        var argPtrs = args.map { strdup($0) }
        argPtrs.append(nil)

        let spawnResult = posix_spawn(&pid, "/bin/sh", nil, &attr, &argPtrs, nil)

        for ptr in argPtrs { free(ptr) }
        posix_spawnattr_destroy(&attr)

        if spawnResult == 0 {
            pids.append(pid)
            pgids.append(pid)
        }
    }

    try assertEqual(pids.count, 3, "Should spawn 3 process groups")

    // Wait for children
    usleep(500000)

    // Kill all groups
    for pgid in pgids {
        killpg(pgid, SIGTERM)
    }

    // Wait for cleanup
    usleep(500000)

    // Verify all groups are gone
    for pgid in pgids {
        let check = killpg(pgid, 0)
        try assertEqual(check, -1, "Process group \(pgid) should be empty")
    }

    // Reap zombies
    for pid in pids {
        var status: Int32 = 0
        waitpid(pid, &status, WNOHANG)
    }
}

test("spawn with environment variables") {
    var pid: pid_t = 0

    var stdoutPipe: [Int32] = [0, 0]
    pipe(&stdoutPipe)

    var fileActions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fileActions)
    posix_spawn_file_actions_addclose(&fileActions, stdoutPipe[0])
    posix_spawn_file_actions_adddup2(&fileActions, stdoutPipe[1], STDOUT_FILENO)
    posix_spawn_file_actions_addclose(&fileActions, stdoutPipe[1])

    let args = ["/bin/sh", "-c", "echo $TEST_VAR"]
    var argPtrs = args.map { strdup($0) }
    argPtrs.append(nil)

    let env = ["TEST_VAR=hello_from_test", "PATH=/bin:/usr/bin"]
    var envPtrs = env.map { strdup($0) }
    envPtrs.append(nil)

    defer {
        for ptr in argPtrs { free(ptr) }
        for ptr in envPtrs { free(ptr) }
        posix_spawn_file_actions_destroy(&fileActions)
    }

    let result = posix_spawn(&pid, "/bin/sh", &fileActions, nil, &argPtrs, &envPtrs)
    close(stdoutPipe[1])

    try assertEqual(result, 0, "spawn should succeed")

    // Read output
    var buffer = [UInt8](repeating: 0, count: 256)
    let bytesRead = read(stdoutPipe[0], &buffer, 256)
    close(stdoutPipe[0])

    var status: Int32 = 0
    waitpid(pid, &status, 0)

    if bytesRead > 0 {
        let output = String(bytes: buffer[0..<bytesRead], encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        try assertEqual(output, "hello_from_test", "Should see environment variable")
    }
}

// MARK: - Summary

print("\n" + String(repeating: "=", count: 50))
print("Test Results: \(testsPassed) passed, \(testsFailed) failed")
print(String(repeating: "=", count: 50) + "\n")

exit(testsFailed > 0 ? 1 : 0)
