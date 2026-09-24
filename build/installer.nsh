; GitClient: custom NSIS include for electron-builder (picked up automatically
; from build/installer.nsh; see electron-builder "nsis.include").
;
; On install:
;   1. Adds $INSTDIR (which contains gitclient.exe) to the per-user PATH
;      (HKCU\Environment\Path, REG_EXPAND_SZ), so `gitclient` / `gitclient <dir>`
;      works in a NEW terminal. Nothing is written when it is already present.
;   2. Registers the "Open in GitClient" Explorer context-menu entry for folders
;      and folder backgrounds (HKCU\Software\Classes\Directory[\Background]\shell\GitClient).
;      The app can toggle this entry later from Settings; it writes and deletes
;      the same keys, so keep the key names below in sync with the app.
; On uninstall: removes both again.
;
; Upgrades: electron-builder runs the previous version's uninstaller with
; --updated before installing the new files, so customUnInstall does nothing
; when ${isUpdated} is set (PATH and the Explorer entry survive upgrades), and
; customInstall does not re-create the Explorer entry on an electron-updater
; upgrade (--updated), so a user who turned it off in Settings keeps it off.
;
; No third-party plugins: only built-in instructions, LogicLib and WinMessages.
; electron-builder compiles with -WX (warnings are errors), and an unreferenced
; function is a warning, so installer-only and uninstaller-only ("un.") functions
; are guarded by BUILD_UNINSTALLER: the uninstaller is compiled in a separate
; pass with BUILD_UNINSTALLER defined, where only customUnInstall is inserted.

!include LogicLib.nsh
!include WinMessages.nsh

!define GITCLIENT_ENV_KEY "Environment"
!define GITCLIENT_MENU_DIR_KEY "Software\Classes\Directory\shell\GitClient"
!define GITCLIENT_MENU_BG_KEY "Software\Classes\Directory\Background\shell\GitClient"

; -----------------------------------------------------------------------------
; PATH helpers, emitted once per compile pass with the right prefix ("" or "un.").
; -----------------------------------------------------------------------------
!macro GITCLIENT_PATH_HELPERS UN
  ; Reads HKCU\Environment\Path.
  ; Out: $R0 = value ("" when absent), $R1 = 1 if it is safe to rewrite it
  ; (read completely, or absent), 0 if it exists but could not be read in full
  ; (longer than NSIS_MAX_STRLEN): rewriting it would truncate the user's PATH.
  Function ${UN}gitclientReadUserPath
    Push $R2
    Push $R3
    ClearErrors
    ReadRegStr $R0 HKCU "${GITCLIENT_ENV_KEY}" "Path"
    ${If} ${Errors}
      ; Either no Path value, or one that does not fit the string buffer.
      StrCpy $R0 ""
      StrCpy $R1 1
      StrCpy $R2 0
      ${Do}
        ClearErrors
        EnumRegValue $R3 HKCU "${GITCLIENT_ENV_KEY}" $R2
        ${If} ${Errors}
        ${OrIf} $R3 == ""
          ${Break}
        ${EndIf}
        ; LogicLib == is case-insensitive (StrCmp).
        ${If} $R3 == "Path"
          StrCpy $R1 0
          ${Break}
        ${EndIf}
        IntOp $R2 $R2 + 1
      ${Loop}
    ${Else}
      StrCpy $R1 1
      StrLen $R2 $R0
      IntOp $R2 $R2 + 1
      ${If} $R2 >= ${NSIS_MAX_STRLEN}
        StrCpy $R1 0 ; possibly truncated
      ${EndIf}
    ${EndIf}
    Pop $R3
    Pop $R2
  FunctionEnd

  ; In: $R0 = PATH value.
  ; Out: $R4 = PATH without $INSTDIR entries (empty entries dropped),
  ;      $R5 = 1 if $INSTDIR was present (with or without a trailing "\").
  ; Comparison is case-insensitive, like Windows paths.
  Function ${UN}gitclientStripInstDir
    Push $0
    Push $1
    Push $2
    Push $3
    Push $R6
    Push $R8
    Push $R9
    StrCpy $R4 ""
    StrCpy $R5 0
    StrCpy $R6 "$R0;" ; trailing separator flushes the last entry
    StrCpy $R9 ""     ; current entry
    StrCpy $R8 0      ; index
    StrLen $1 $R6
    ${DoWhile} $R8 < $1
      StrCpy $0 $R6 1 $R8
      ${If} $0 == ";"
        StrCpy $2 $R9
        StrCpy $3 $2 1 -1
        ${If} $3 == "\"
          StrCpy $2 $2 -1
        ${EndIf}
        ${If} $2 == $INSTDIR
          StrCpy $R5 1
        ${ElseIf} $R9 != ""
          ${If} $R4 == ""
            StrCpy $R4 $R9
          ${Else}
            StrCpy $R4 "$R4;$R9"
          ${EndIf}
        ${EndIf}
        StrCpy $R9 ""
      ${Else}
        StrCpy $R9 "$R9$0"
      ${EndIf}
      IntOp $R8 $R8 + 1
    ${Loop}
    Pop $R9
    Pop $R8
    Pop $R6
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
  !insertmacro GITCLIENT_PATH_HELPERS "un."

  Function un.gitclientRemoveFromPath
    Push $R0
    Push $R1
    Push $R4
    Push $R5
    Call un.gitclientReadUserPath
    ${If} $R1 != 1
      DetailPrint "GitClient: PATH is too long to edit safely; remove $INSTDIR from it manually."
    ${Else}
      Call un.gitclientStripInstDir
      ${If} $R5 == 1
        ${If} $R4 == ""
          DeleteRegValue HKCU "${GITCLIENT_ENV_KEY}" "Path"
        ${Else}
          WriteRegExpandStr HKCU "${GITCLIENT_ENV_KEY}" "Path" $R4
        ${EndIf}
        SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
      ${EndIf}
    ${EndIf}
    Pop $R5
    Pop $R4
    Pop $R1
    Pop $R0
  FunctionEnd
!else
  !insertmacro GITCLIENT_PATH_HELPERS ""

  Function gitclientAddToPath
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Call gitclientReadUserPath
    ${If} $R1 != 1
      DetailPrint "GitClient: PATH is too long to edit safely; add $INSTDIR to it manually."
    ${Else}
      Call gitclientStripInstDir
      ${If} $R5 != 1
        ; Append to the original value (not the normalised $R4) so the user's
        ; PATH is otherwise left byte-for-byte unchanged.
        ${If} $R0 == ""
          StrCpy $R2 $INSTDIR
        ${Else}
          StrCpy $R3 $R0 1 -1
          ${If} $R3 == ";"
            StrCpy $R2 "$R0$INSTDIR"
          ${Else}
            StrCpy $R2 "$R0;$INSTDIR"
          ${EndIf}
        ${EndIf}
        StrLen $R3 $R2
        IntOp $R3 $R3 + 1
        ${If} $R3 >= ${NSIS_MAX_STRLEN}
          DetailPrint "GitClient: PATH would be too long; add $INSTDIR to it manually."
        ${Else}
          WriteRegExpandStr HKCU "${GITCLIENT_ENV_KEY}" "Path" $R2
          SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
        ${EndIf}
      ${EndIf}
    ${EndIf}
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd
!endif

; -----------------------------------------------------------------------------
; Explorer context menu ("Open in GitClient"). Same keys the app's Settings
; toggle writes/deletes. %V is the clicked folder (or the folder whose
; background was clicked).
; -----------------------------------------------------------------------------
!macro GITCLIENT_WRITE_MENU_KEY KEY
  WriteRegStr HKCU "${KEY}" "" "Open in GitClient"
  WriteRegStr HKCU "${KEY}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "${KEY}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
!macroend

!macro customInstall
  Call gitclientAddToPath
  ${IfNot} ${isUpdated}
    !insertmacro GITCLIENT_WRITE_MENU_KEY "${GITCLIENT_MENU_DIR_KEY}"
    !insertmacro GITCLIENT_WRITE_MENU_KEY "${GITCLIENT_MENU_BG_KEY}"
  ${EndIf}
!macroend

!macro customUnInstall
  ; Upgrade in progress (old uninstaller run by the new installer): keep PATH
  ; and the Explorer entry; the new version uses the same $INSTDIR.
  ${IfNot} ${isUpdated}
    Call un.gitclientRemoveFromPath
    DeleteRegKey HKCU "${GITCLIENT_MENU_DIR_KEY}"
    DeleteRegKey HKCU "${GITCLIENT_MENU_BG_KEY}"
  ${EndIf}
!macroend
