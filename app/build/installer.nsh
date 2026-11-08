; DSpatch's own pages and steps in electron-builder's NSIS installer (DSP-182, Niclas's decisions
; of 8 November 2026). electron-builder's template inserts each macro where its name says; see
; node_modules/app-builder-lib/templates/nsis. This file is included before MUI2, so everything
; that needs MUI lives inside a macro and is expanded where the template inserts it. Nothing here
; signs anything.

!include LogicLib.nsh
!include WinMessages.nsh
!include nsDialogs.nsh

; Per user, without administrator rights: the template would otherwise ask whether to install for
; everyone or for this user. The installer and its uninstaller both work in the current user's
; profile and registry.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The desktop shortcut is the person's choice, unchecked by default, on a page of its own after
; the folder page. The template creates no desktop shortcut itself (createDesktopShortcut is off
; in electron-builder.yml); the Start menu entry it creates always. A silent install (/S) shows no
; pages and so creates no desktop shortcut.
!macro customPageAfterChangeDir
  Var /GLOBAL dspatchDesktopShortcutBox
  Var /GLOBAL dspatchDesktopShortcut

  Function dspatchShortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose how DSpatch is reached."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 24u "DSpatch gets an entry in the Start menu. A desktop shortcut is optional."
    Pop $0
    ${NSD_CreateCheckbox} 0 30u 100% 12u "Create a &desktop shortcut"
    Pop $dspatchDesktopShortcutBox
    ${NSD_Uncheck} $dspatchDesktopShortcutBox
    nsDialogs::Show
  FunctionEnd

  Function dspatchShortcutPageLeave
    ${NSD_GetState} $dspatchDesktopShortcutBox $dspatchDesktopShortcut
  FunctionEnd

  Page custom dspatchShortcutPageCreate dspatchShortcutPageLeave
!macroend

!macro customInstall
  ${If} $dspatchDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${EndIf}
!macroend

; The template removes no desktop shortcut it did not create: the uninstaller removes the one the
; page above made, when the person kept it. App data under %APPDATA%\DSpatch is never touched.
!macro customUnInstall
  WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
!macroend
