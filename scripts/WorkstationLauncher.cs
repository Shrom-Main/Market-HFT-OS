using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace MarketHftOs
{
    /// <summary>
    /// Gate M7.0 (Decision OD-20 / Charter DEC-020):
    /// Standalone Native Windows Workstation 1-Click Launcher
    /// 
    /// Compiles with built-in Windows csc.exe (/target:winexe) - zero npm dependencies.
    /// Double-clicking POC-001-Workstation.exe:
    /// 1. Probes http://127.0.0.1:4310/api/health to check if daemon is running.
    /// 2. If offline, silently boots start_workstation.bat in the background.
    /// 3. Polls loopback health endpoint until ready (up to 10 seconds).
    /// 4. Opens http://127.0.0.1:4310 in the operator's default browser.
    /// 5. Gracefully falls back to dist\POC-001_Standalone_Workstation.html if daemon cannot start.
    /// </summary>
    internal static class WorkstationLauncher
    {
        private const string DaemonUrl = "http://127.0.0.1:4310";
        private const string HealthEndpoint = "http://127.0.0.1:4310/api/health";

        [STAThread]
        private static void Main(string[] args)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string batFile = Path.Combine(appDir, "start_workstation.bat");
            string standaloneHtml = Path.Combine(appDir, "dist", "POC-001_Standalone_Workstation.html");

            bool isHealthy = ProbeHealth(HealthEndpoint);

            if (!isHealthy)
            {
                // Silently launch daemon via start_workstation.bat
                if (File.Exists(batFile))
                {
                    try
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = "cmd.exe",
                            Arguments = "/c \"" + batFile + "\"",
                            WorkingDirectory = appDir,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true,
                            UseShellExecute = true
                        };
                        Process.Start(psi);
                    }
                    catch
                    {
                        // Fallback: try booting node tsx directly
                        TryDirectNodeLaunch(appDir);
                    }
                }
                else
                {
                    TryDirectNodeLaunch(appDir);
                }

                // Poll for health endpoint up to 10 seconds (10 x 1000ms)
                for (int i = 0; i < 10; i++)
                {
                    Thread.Sleep(1000);
                    if (ProbeHealth(HealthEndpoint))
                    {
                        isHealthy = true;
                        break;
                    }
                }
            }

            if (isHealthy)
            {
                // Open live loopback browser workstation
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = DaemonUrl,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Workstation loopback daemon is running at " + DaemonUrl + " but could not open the default browser.\n\n" + ex.Message,
                        "Market HFT OS — Browser Launch",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }
            }
            else
            {
                // Daemon did not report healthy; fallback to offline standalone HTML
                if (File.Exists(standaloneHtml))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = standaloneHtml,
                            UseShellExecute = true
                        });
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show(
                            "Could not open standalone workstation HTML file:\n" + standaloneHtml + "\n\n" + ex.Message,
                            "Market HFT OS — Launch Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                    }
                }
                else
                {
                    MessageBox.Show(
                        "Workstation daemon at " + DaemonUrl + " is offline, and standalone HTML was not found at:\n" + standaloneHtml + "\n\nPlease run 'npm run workstation:export' to generate the offline view.",
                        "Market HFT OS — Workstation Offline",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                }
            }
        }

        private static bool ProbeHealth(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1200;
                req.ReadWriteTimeout = 1200;
                req.Method = "GET";
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void TryDirectNodeLaunch(string appDir)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npx tsx src/cli/workstationCli.ts",
                    WorkingDirectory = appDir,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            catch
            {
                // Ignore failure
            }
        }
    }
}
