; Installeur Windows de Stonks (NSIS 3)
; Variables passées par scripts/build-win.js :
;   VERSION   ex. 2.0.0
;   SRC_DIR   dossier produit par @electron/packager (contient Stonks.exe)
;   OUT_FILE  chemin de l'installeur à créer
;   ICON      icône .ico
;
; Stonks remplace BuildSense (ancien nom de l'appli) : l'installeur retire l'ancienne installation
; (dossier, raccourcis, entrée "Applications installées"). Les réglages et les données, dans %APPDATA%,
; ne sont jamais touchés : Stonks les reprend tels quels.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "Stonks"
OutFile "${OUT_FILE}"
; Dossier dédié, par utilisateur (pas besoin des droits administrateur)
InstallDir "$LOCALAPPDATA\Programs\Stonks"
BrandingText "Stonks ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "Stonks"
VIAddVersionKey /LANG=1036 "FileDescription" "Installeur de Stonks"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "CompanyName" "Stonks"
VIAddVersionKey /LANG=1036 "LegalCopyright" "Projet personnel"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installer Stonks"
!define MUI_WELCOMEPAGE_TEXT "Coach et overlay de builds pour League of Legends, basé sur les parties des meilleurs joueurs.$\r$\n$\r$\nStonks s'installe dans ton dossier utilisateur : aucun droit administrateur n'est nécessaire.$\r$\n$\r$\nSi BuildSense (l'ancien nom de l'appli) est installé, il est remplacé : tes réglages et tes données sont gardés."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Stonks.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer Stonks"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Stonks"
; ancienne appli (avant le changement de nom)
!define OLD_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BuildSense"
!define OLD_DIR "$LOCALAPPDATA\Programs\BuildSense"

; Mise à jour depuis l'appli : <installeur> /S --relaunch
;   /S         : installation silencieuse (aucune fenêtre)
;   --relaunch : relance Stonks à la fin
Section "Stonks"
  ; ferme une version déjà ouverte avant de la remplacer
  ; (mise à jour : on laisse d'abord l'appli se fermer proprement)
  ${If} ${Silent}
    Sleep 2000
  ${EndIf}
  nsExec::Exec 'taskkill /IM Stonks.exe /F'
  nsExec::Exec 'taskkill /IM BuildSense.exe /F'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; mise à jour propre des fichiers de l'appli (les réglages et données sont dans %APPDATA%)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC_DIR}\*.*"
  WriteUninstaller "$INSTDIR\Desinstaller Stonks.exe"

  CreateDirectory "$SMPROGRAMS\Stonks"
  CreateShortcut "$SMPROGRAMS\Stonks\Stonks.lnk" "$INSTDIR\Stonks.exe"
  CreateShortcut "$SMPROGRAMS\Stonks\Désinstaller Stonks.lnk" "$INSTDIR\Desinstaller Stonks.exe"
  ; raccourci du bureau : à la première installation (une mise à jour ne le recrée pas s'il a été supprimé),
  ; ou pour remplacer celui de l'ancienne appli
  ${IfNot} ${Silent}
    CreateShortcut "$DESKTOP\Stonks.lnk" "$INSTDIR\Stonks.exe"
  ${EndIf}
  ${If} ${FileExists} "$DESKTOP\BuildSense.lnk"
    Delete "$DESKTOP\BuildSense.lnk"
    CreateShortcut "$DESKTOP\Stonks.lnk" "$INSTDIR\Stonks.exe"
  ${EndIf}

  ; ancienne installation (BuildSense) : dossier, menu Démarrer, entrée de désinstallation
  RMDir /r "$SMPROGRAMS\BuildSense"
  ${If} ${FileExists} "${OLD_DIR}\*.*"
    RMDir /r "${OLD_DIR}"
    ${If} ${FileExists} "${OLD_DIR}\*.*"
      ; un fichier encore utilisé (appli en train de se fermer) : deuxième essai
      Sleep 1500
      RMDir /r "${OLD_DIR}"
    ${EndIf}
  ${EndIf}
  DeleteRegKey HKCU "${OLD_UNINST_KEY}"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Stonks"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Stonks"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Stonks.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstaller Stonks.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--relaunch" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\Stonks.exe"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Stonks.exe /F'
  Sleep 500
  Delete "$DESKTOP\Stonks.lnk"
  RMDir /r "$SMPROGRAMS\Stonks"
  ; $INSTDIR est toujours le dossier dédié "Programs\Stonks" (pas de choix de dossier)
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
