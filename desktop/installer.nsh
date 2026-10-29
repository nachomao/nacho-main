!macro customInit
  # 清理旧版本可能存在的卸载注册表项中的 UninstallString，
  # 避免新安装程序在升级检测时执行旧版带有 StartsWith 缺陷的卸载程序导致无限循环提示"无法关闭"
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  !endif
!macroend

!macro customCheckAppRunning
  # 1. 确保旧卸载项不会触发旧卸载程序
  DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  !endif

  # 2. 精确检查 NachoPanel.exe 进程是否正在运行，避免 electron-builder 默认逻辑在 $INSTDIR 为空时误匹配所有系统进程
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
