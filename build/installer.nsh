!include "nsProcess.nsh"

!macro closePlayerProcess PROCESS_NAME
  ${nsProcess::CloseProcess} "${PROCESS_NAME}" $R0
  Sleep 700
  ${nsProcess::FindProcess} "${PROCESS_NAME}" $R0
  StrCmp $R0 0 0 +3
    ${nsProcess::KillProcess} "${PROCESS_NAME}" $R0
    Sleep 400
!macroend

!macro customInit
  !insertmacro closePlayerProcess "Immersive Lyrics.exe"
  !insertmacro closePlayerProcess "ImmersiveLyrics.exe"
  !insertmacro closePlayerProcess "player-server.exe"
  ${nsProcess::Unload}
!macroend
