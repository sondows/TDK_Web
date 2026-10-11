using System.Diagnostics;

internal sealed class PosEdgeManager
{
    private const string PosUrl = "http://192.168.0.83:3000/pos";
    private readonly object gate = new();
    private int? managedProcessId;
    private Process? launchedProcess;
    private readonly string profilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TDK-POS", "EdgeProfile");
    private readonly ILogger<PosEdgeManager> logger;

    public PosEdgeManager(ILogger<PosEdgeManager> logger) => this.logger = logger;

    public void EnsureStarted()
    {
        if (!OperatingSystem.IsWindows()) return;

        lock (gate)
        {
            var existingProcessIds = FindManagedProcessIds();
            if (existingProcessIds.Count > 0)
            {
                managedProcessId = existingProcessIds[0];
                logger.LogInformation("TDK-POS Edge is already running with PID {ProcessId}", managedProcessId);
                return;
            }

            var edgePath = FindEdgeExecutable();
            if (edgePath is null) throw new FileNotFoundException("Microsoft Edge 실행 파일을 찾을 수 없습니다.");

            Directory.CreateDirectory(profilePath);
            var startInfo = new ProcessStartInfo(edgePath)
            {
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add($"--app={PosUrl}");
            startInfo.ArgumentList.Add($"--user-data-dir={profilePath}");
            startInfo.ArgumentList.Add("--no-first-run");
            startInfo.ArgumentList.Add("--start-maximized");

            launchedProcess?.Dispose();
            launchedProcess = Process.Start(startInfo)
                ?? throw new InvalidOperationException("TDK-POS Edge를 시작하지 못했습니다.");
            managedProcessId = launchedProcess.Id;
            logger.LogInformation("TDK-POS Edge started with PID {ProcessId}", launchedProcess.Id);
        }
    }

    public bool Stop()
    {
        if (!OperatingSystem.IsWindows()) return false;

        lock (gate)
        {
            var stoppedAny = false;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var processIds = FindManagedProcessIds();
                var launchedId = launchedProcess is { HasExited: false } launched ? launched.Id : (int?)null;
                var storedPidMatched = managedProcessId is int storedId && processIds.Contains(storedId);
                logger.LogInformation(
                    "TDK-POS Edge exit attempt {Attempt}: stored PID {StoredPid}, stored PID matched profile {StoredPidMatched}, launched PID {LaunchedPid}, profile root PIDs {ProcessIds}",
                    attempt + 1, managedProcessId, storedPidMatched, launchedId, string.Join(",", processIds));

                if (managedProcessId is int trackedId && processIds.Remove(trackedId))
                    processIds.Insert(0, trackedId);
                if (launchedId is int ownId && !processIds.Contains(ownId))
                    processIds.Add(ownId);

                if (processIds.Count == 0)
                {
                    if (!stoppedAny)
                        logger.LogWarning("No live TDK-POS Edge PID was found for stored PID {StoredPid}", managedProcessId);
                    break;
                }

                foreach (var processId in processIds)
                {
                    // A stored PID is only used if it still belongs to the dedicated
                    // POS profile. The launch handle is safe because this agent owns it.
                    if (processId != launchedId && !FindManagedProcessIds().Contains(processId))
                        continue;
                    stoppedAny |= StopProcessTree(processId);
                }
            }

            var remainingIds = FindManagedProcessIds();
            if (remainingIds.Count > 0)
                throw new InvalidOperationException($"TDK-POS Edge profile is still running with PID(s): {string.Join(",", remainingIds)}");
            launchedProcess?.Dispose();
            launchedProcess = null;
            managedProcessId = null;
            return stoppedAny;
        }
    }

    private bool StopProcessTree(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            if (process.HasExited) return false;
        }
        catch (ArgumentException)
        {
            logger.LogInformation("TDK-POS Edge PID {ProcessId} no longer exists", processId);
            return false;
        }

        var taskkill = Path.Combine(Environment.SystemDirectory, "taskkill.exe");
        var startInfo = new ProcessStartInfo(taskkill)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add("/PID");
        startInfo.ArgumentList.Add(processId.ToString());
        startInfo.ArgumentList.Add("/T");
        startInfo.ArgumentList.Add("/F");
        logger.LogInformation("TDK-POS Edge PID {ProcessId} exists; running {Command}",
            processId, $"{taskkill} /PID {processId} /T /F");
        using var killer = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"taskkill could not start for TDK-POS Edge PID {processId}");
        var outputTask = killer.StandardOutput.ReadToEndAsync();
        var errorTask = killer.StandardError.ReadToEndAsync();
        if (!killer.WaitForExit(10000))
        {
            killer.Kill();
            throw new TimeoutException($"taskkill timed out for TDK-POS Edge PID {processId}");
        }
        var output = outputTask.GetAwaiter().GetResult();
        var error = errorTask.GetAwaiter().GetResult();
        logger.LogInformation("TDK-POS Edge taskkill PID {ProcessId}: exit code {ExitCode}, output {Output}, error {Error}",
            processId, killer.ExitCode, output.Trim(), error.Trim());
        if (killer.ExitCode != 0 && ProcessExists(processId))
            throw new InvalidOperationException($"taskkill failed for TDK-POS Edge PID {processId}: {error.Trim()}");
        return true;
    }

    private static bool ProcessExists(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited;
        }
        catch (ArgumentException) { return false; }
    }

    private List<int> FindManagedProcessIds()
    {
        // Edge can hand an app window to another browser root in its dedicated
        // profile. The root may no longer carry --app, so match the profile and
        // exclude child processes instead of requiring the original app URL.
        var escapedProfile = profilePath.Replace("'", "''");
        var script = $"$profile = '{escapedProfile}'; " +
            "$session = (Get-Process -Id $PID).SessionId; " +
            "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | " +
            "Where-Object { $_.SessionId -eq $session -and $_.CommandLine -and " +
            "$_.CommandLine.Contains('--user-data-dir=') -and $_.CommandLine.Contains($profile) -and " +
            "$_.CommandLine -notmatch '(^|\\s)--type=' } | " +
            "ForEach-Object { $_.ProcessId }";

        var powerShell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        var startInfo = new ProcessStartInfo(powerShell)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-Command");
        startInfo.ArgumentList.Add(script);

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Edge 프로세스 확인을 시작하지 못했습니다.");
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0 || error.Length > 0)
            throw new InvalidOperationException($"Edge 프로세스 확인 실패: {error.Trim()}");

        var processIds = new List<int>();
        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!int.TryParse(line, out var processId))
                throw new InvalidOperationException("Edge 프로세스 확인 결과를 읽지 못했습니다.");
            processIds.Add(processId);
        }
        return processIds;
    }

    private static string? FindEdgeExecutable()
    {
        foreach (var root in new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        })
        {
            if (string.IsNullOrEmpty(root)) continue;
            var path = Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(path)) return path;
        }
        return null;
    }
}
