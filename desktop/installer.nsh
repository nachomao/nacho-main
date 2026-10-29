!macro customInit
  SetRegView 64
  DeleteRegValue HKEY_LOCAL_MACHINE "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "UninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "QuietUninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  DeleteRegValue HKEY_CURRENT_USER "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "UninstallString"
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  SetRegView 32
  DeleteRegValue HKEY_LOCAL_MACHINE "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "UninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "QuietUninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  DeleteRegValue HKEY_CURRENT_USER "Software\Microsoft\Windows\CurrentVersion\Uninstall\b6ff9fd0-e181-59d2-a131-087aaf72357a" "UninstallString"
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  SetRegView 64
  Delete "$PROGRAMFILES64\NachoPanel\Uninstall NachoPanel.exe"
  Delete "$PROGRAMFILES\NachoPanel\Uninstall NachoPanel.exe"
!macroend

!macro customCheckAppRunning
  # 精确检查 NachoPanel.exe 进程是否正在运行，避免 electron-builder 默认逻辑在 $INSTDIR 为空时误匹配所有系统进程
  nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $0
  ${if} $0 == 0
    # 进程确实在运行
    ${if} ${isUpdated}
      nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
      Sleep 500
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcessCustom
      Quit
      doStopProcessCustom:
      nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
      Sleep 500
    ${endif}
  ${endif}
!macroend

!macro customUnInstallCheck
  # 忽略旧卸载程序的非零退出码，新安装程序会直接覆盖写入新文件
!macroend

!macro customUnInstallCheckCurrentUser
  # 忽略旧卸载程序的非零退出码
!macroend
