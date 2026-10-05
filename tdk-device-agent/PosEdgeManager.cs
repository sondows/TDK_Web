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
            // The handle returned by Process.Start belongs to this agent's Edge
            // launch. Use it directly while it is alive; no other Edge can match it.
            if (launchedProcess is { } launched)
            {
                try
                {
                    if (!launched.HasExited)
                    {
                        launched.Kill(entireProcessTree: true);
                        if (!launched.WaitForExit(3000))
                            throw new TimeoutException($"TDK-POS Edge PID {launched.Id} did not exit.");
                        logger.LogInformation("TDK-POS Edge stopped with PID {ProcessId}", launched.Id);
                        managedProcessId = null;
                        return true;
                    }
                }
                catch (InvalidOperationException)
                {
                    // Edge handed the app window to another process in its profile.
                }
                finally
                {
                    launched.Dispose();
                    launchedProcess = null;
                }
            }

            // After an agent restart, rediscover only the Edge root launched with
            // the POS app URL and this agent's dedicated profile.
            var processIds = FindManagedProcessIds();
            if (processIds.Count == 0) return false;

            if (managedProcessId is int trackedId && processIds.Remove(trackedId))
                processIds.Insert(0, trackedId);

            foreach (var processId in processIds)
            {
                try
                {
                    using var process = Process.GetProcessById(processId);
                    process.Kill(entireProcessTree: true);
                    if (!process.WaitForExit(3000))
                        throw new TimeoutException($"TDK-POS Edge PID {processId} did not exit.");
                    logger.LogInformation("TDK-POS Edge stopped with PID {ProcessId}", processId);
                }
                catch (ArgumentException)
                {
                    // The POS window closed after the process list was read.
                }
                catch (InvalidOperationException)
                {
                    // The POS window closed after the process list was read.
                }
            }

            managedProcessId = null;
            return true;
        }
    }

    private List<int> FindManagedProcessIds()
    {
        // A dedicated profile gives the POS its own Edge browser process. Match both
        // that profile and the app URL before terminating any process.
        var escapedProfile = profilePath.Replace("'", "''");
        var script = $"$profile = '{escapedProfile}'; $url = '{PosUrl}'; " +
            "$session = (Get-Process -Id $PID).SessionId; " +
            "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | " +
            "Where-Object { $_.SessionId -eq $session -and $_.CommandLine -and " +
            "$_.CommandLine.Contains('--user-data-dir=') -and $_.CommandLine.Contains($profile) -and " +
            "$_.CommandLine.Contains('--app=') -and $_.CommandLine.Contains($url) } | " +
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
