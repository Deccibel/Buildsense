; Installeur Windows de BuildSense (NSIS 3)
; Variables passées par scripts/build-win.js :
;   VERSION   ex. 1.1.0
;   SRC_DIR   dossier produit par @electron/packager (contient BuildSense.exe)
;   OUT_FILE  chemin de l'installeur à créer
;   ICON      icône .ico

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "BuildSense"
OutFile "${OUT_FILE}"
; Dossier dédié, par utilisateur (pas besoin des droits administrateur)
InstallDir "$LOCALAPPDATA\Programs\BuildSense"
BrandingText "BuildSense ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "BuildSense"
VIAddVersionKey /LANG=1036 "FileDescription" "Installeur de BuildSense"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "CompanyName" "BuildSense"
VIAddVersionKey /LANG=1036 "LegalCopyright" "Projet personnel"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installer BuildSense"
!define MUI_WELCOMEPAGE_TEXT "Overlay de builds pour League of Legends, basé sur les parties des meilleurs joueurs.$\r$\n$\r$\nBuildSense s'installe dans ton dossier utilisateur : aucun droit administrateur n'est nécessaire."
!define MUI_FINISHPAGE_RUN "$INSTDIR\BuildSense.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer BuildSense"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BuildSense"

; Mise à jour depuis l'appli : BuildSense-Setup.exe /S --relaunch
;   /S         : installation silencieuse (aucune fenêtre)
;   --relaunch : relance BuildSense à la fin
Section "BuildSense"
  ; ferme une version déjà ouverte avant de la remplacer
  ; (mise à jour : on laisse d'abord l'appli se fermer proprement)
  ${If} ${Silent}
    Sleep 2000
  ${EndIf}
  nsExec::Exec 'taskkill /IM BuildSense.exe /F'
  Sleep 500
  SetOutPath "$INSTDIR"
  ; mise à jour propre des fichiers de l'appli (les réglages et données sont dans %APPDATA%)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC_DIR}\*.*"
  WriteUninstaller "$INSTDIR\Desinstaller BuildSense.exe"

  CreateDirectory "$SMPROGRAMS\BuildSense"
  CreateShortcut "$SMPROGRAMS\BuildSense\BuildSense.lnk" "$INSTDIR\BuildSense.exe"
  CreateShortcut "$SMPROGRAMS\BuildSense\Désinstaller BuildSense.lnk" "$INSTDIR\Desinstaller BuildSense.exe"
  ; raccourci du bureau : seulement à la première installation (une mise à jour ne le recrée pas)
  ${IfNot} ${Silent}
    CreateShortcut "$DESKTOP\BuildSense.lnk" "$INSTDIR\BuildSense.exe"
  ${EndIf}

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "BuildSense"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "BuildSense"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\BuildSense.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstaller BuildSense.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--relaunch" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\BuildSense.exe"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM BuildSense.exe /F'
  Sleep 500
  Delete "$DESKTOP\BuildSense.lnk"
  RMDir /r "$SMPROGRAMS\BuildSense"
  ; $INSTDIR est toujours le dossier dédié "Programs\BuildSense" (pas de choix de dossier)
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
