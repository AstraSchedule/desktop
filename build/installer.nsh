!ifndef BUILD_UNINSTALLER
Var installServer
Var installSchool
Var installGrade
Var installClass
Var installLocalProvince
Var installLocalCity
Var installLegacyLocal
Var installCloud
Var installSecure
Var installAutoLaunch
Var installTopmost
Var installDesktopShortcut
Var installStartMenuShortcut
Var installLaunch
Var installHasAppSettings

Function trimInstallOptionValue
  ; GetOptions 返回匹配项后面的剩余命令行；截断到下一个已知安装参数。
  ; 因此值中的斜杠（例如 39/2023/1）不会被误认为参数边界。
  StrLen $R2 $R1
  StrCpy $R3 0
trimInstallOptionValue_loop:
  StrCpy $R4 $R1 1 $R3
  StrCmp $R4 "" trimInstallOptionValue_done
  StrCmp $R4 " " 0 trimInstallOptionValue_next
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /SCHOOL=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 8 $R3
  StrCmp $R4 " /GRADE=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /SERVER=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 8 $R3
  StrCmp $R4 " /CLASS=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /LOCALP=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /LOCALC=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 8 $R3
  StrCmp $R4 " /LOCAL=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 8 $R3
  StrCmp $R4 " /CLOUD=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /SECURE=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 13 $R3
  StrCmp $R4 " /AUTOLAUNCH=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 10 $R3
  StrCmp $R4 " /TOPMOST=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 18 $R3
  StrCmp $R4 " /DESKTOPSHORTCUT=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 20 $R3
  StrCmp $R4 " /STARTMENUSHORTCUT=" 0 +2
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
  StrCpy $R4 $R1 9 $R3
  StrCmp $R4 " /LAUNCH=" 0 trimInstallOptionValue_next
    StrCpy $R1 $R1 $R3
    Goto trimInstallOptionValue_done
trimInstallOptionValue_next:
  IntOp $R3 $R3 + 1
  Goto trimInstallOptionValue_loop
trimInstallOptionValue_done:
  ; 去除包住值的双引号。
  StrCpy $R4 $R1 1
  StrCmp $R4 '"' 0 +5
    StrCpy $R1 $R1 '' 1
    StrCpy $R4 $R1 1 -1
    StrCmp $R4 '"' 0 +2
      StrCpy $R1 $R1 -1
FunctionEnd

!macro customInit
  ; 确保在 Windows 7 上的兼容性
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  StrCmp $0 "" 0 +2
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  
  ; 检查 Windows 版本，确保兼容性
  ${If} ${AtLeastWin7}
    ; Windows 7 或更高版本
  ${EndIf}
  
  ; 为 Windows 7 设置兼容性标志
  ExecWait '"$INSTDIR\mscoree.dll" /s /v/q'
  
  ; 确保使用正确的权限
  SetShellVarContext all

  ; 读取命令行安装参数。未传入的参数保持空值，由应用使用原有默认值。
  StrCpy $installHasAppSettings "0"
  StrCpy $installDesktopShortcut "1"
  StrCpy $installStartMenuShortcut "1"
  StrCpy $installLaunch "1"
  ${GetParameters} $R0

  ${GetOptions} $R0 "/SCHOOL=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installSchool $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/GRADE=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installGrade $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/SERVER=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installServer $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/CLASS=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installClass $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/LOCALP=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installLocalProvince $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/LOCALC=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installLocalCity $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/LOCAL=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installLegacyLocal $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}

  ${GetOptions} $R0 "/CLOUD=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installCloud $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/SECURE=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installSecure $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/AUTOLAUNCH=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installAutoLaunch $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}
  ${GetOptions} $R0 "/TOPMOST=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installTopmost $R1
    StrCpy $installHasAppSettings "1"
  ${EndIf}

  ${GetOptions} $R0 "/DESKTOPSHORTCUT=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installDesktopShortcut $R1
  ${EndIf}
  ${GetOptions} $R0 "/STARTMENUSHORTCUT=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installStartMenuShortcut $R1
  ${EndIf}
  ${GetOptions} $R0 "/LAUNCH=" $R1
  ${IfNot} ${Errors}
    Call trimInstallOptionValue
    StrCpy $installLaunch $R1
  ${EndIf}
!macroend

!macro customInstall
  ; electron-builder 已创建默认快捷方式；按命令行参数删除不需要的快捷方式。
  ${If} $installDesktopShortcut == "0"
    Delete "$newDesktopLink"
  ${EndIf}
  ${If} $installStartMenuShortcut == "0"
    Delete "$newStartMenuLink"
  ${EndIf}

  ; 只在收到应用配置参数时生成一次性初始化文件。
  ${If} $installHasAppSettings == "1"
    FileOpen $0 "$INSTDIR\install-config.ini" w
    FileWrite $0 "[app]$\r$\n"
    ${If} $installServer != ""
      FileWrite $0 "server=$installServer$\r$\n"
    ${EndIf}
    ; 新参数按学校/年级/班级顺序拼接；只填写其中一部分时不添加多余斜杠。
    StrCpy $R5 ""
    ${If} $installSchool != ""
      StrCpy $R5 $installSchool
    ${EndIf}
    ${If} $installGrade != ""
      ${If} $R5 != ""
        StrCpy $R5 "$R5/$installGrade"
      ${Else}
        StrCpy $R5 $installGrade
      ${EndIf}
    ${EndIf}
    ${If} $installClass != ""
      ${If} $R5 != ""
        StrCpy $R5 "$R5/$installClass"
      ${Else}
        StrCpy $R5 $installClass
      ${EndIf}
    ${EndIf}
    ${If} $R5 != ""
      FileWrite $0 "class=$R5$\r$\n"
    ${EndIf}

    ; 新参数按省/市（或地区）顺序拼接；只填写其中一部分时直接使用该值。
    StrCpy $R5 ""
    ${If} $installLocalProvince != ""
      StrCpy $R5 $installLocalProvince
    ${EndIf}
    ${If} $installLocalCity != ""
      ${If} $R5 != ""
        StrCpy $R5 "$R5/$installLocalCity"
      ${Else}
        StrCpy $R5 $installLocalCity
      ${EndIf}
    ${EndIf}
    ${If} $R5 == ""
      StrCpy $R5 $installLegacyLocal
    ${EndIf}
    ${If} $R5 != ""
      FileWrite $0 "local=$R5$\r$\n"
    ${EndIf}
    ${If} $installCloud == "0"
      FileWrite $0 "isFromCloud=false$\r$\n"
    ${ElseIf} $installCloud == "1"
      FileWrite $0 "isFromCloud=true$\r$\n"
    ${EndIf}
    ${If} $installSecure == "0"
      FileWrite $0 "isSecureConnection=false$\r$\n"
    ${ElseIf} $installSecure == "1"
      FileWrite $0 "isSecureConnection=true$\r$\n"
    ${EndIf}
    ${If} $installAutoLaunch == "0"
      FileWrite $0 "isAutoLaunch=false$\r$\n"
    ${ElseIf} $installAutoLaunch == "1"
      FileWrite $0 "isAutoLaunch=true$\r$\n"
    ${EndIf}
    ${If} $installTopmost == "0"
      FileWrite $0 "isWindowAlwaysOnTop=false$\r$\n"
    ${ElseIf} $installTopmost == "1"
      FileWrite $0 "isWindowAlwaysOnTop=true$\r$\n"
    ${EndIf}
    FileClose $0
  ${EndIf}

  ; 自定义启动逻辑，避免安装器模板无条件启动。
  ${If} $installLaunch == "1"
    ${StdUtils.ExecShellAsUser} $1 "$launchLink" "open" ""
  ${EndIf}
!macroend
!endif