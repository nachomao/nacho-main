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
