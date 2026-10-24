@echo off
setlocal
rem DSpatch - the refused or failed resume state in the real window (DSP-121).
rem
rem Everything this window shows is SIMULATED by the presentation adapter: the
rem refusal or failure is its own answer on this machine, no provider is asked
rem anything, and nothing here says what any provider would do with a session.
rem
rem   start-resume-choice.cmd                      the refused state
rem   start-resume-choice.cmd failed               the failed state
rem   start-resume-choice.cmd refused-once         refused once, then Try again succeeds
rem   start-resume-choice.cmd reset [mode]         delete the kit and seed it again first
rem
rem The kit (a seeded user-data directory and a project A with three saved messages)
rem lives under %TEMP% and is separate from your real DSpatch data. Needs node on
rem PATH and "npm run build" done in app\.

set "KIT=%TEMP%\dspatch-resume-choice"
set "APP=%~dp0.."
set "MODE=%~2"
if /I not "%~1"=="reset" if not "%~1"=="" set "MODE=%~1"
if "%MODE%"=="" set "MODE=refused"

rem Only the three simulated states are meaningful here; anything else is refused
rem before the kit is touched.
if /I not "%MODE%"=="refused" if /I not "%MODE%"=="failed" if /I not "%MODE%"=="refused-once" (
  echo "%MODE%" is not a resume state this file knows. Use one of: refused, failed, refused-once
  pause
  exit /b 2
)

if /I "%~1"=="reset" (
  if exist "%KIT%" (
    echo Removing the kit %KIT% ...
    rmdir /S /Q "%KIT%"
  )
)

if not exist "%APP%\dist\main\main.js" (
  echo The built files are missing: run "npm run build" in %APP% first.
  pause
  exit /b 1
)

if not exist "%KIT%\userData" (
  echo Seeding the kit %KIT% - no provider is called ...
  pushd "%APP%"
  call node --import ./scripts/ts-resolve.mjs scripts/seed-switch-kit.mjs "%KIT%" >nul
  if errorlevel 1 (
    popd
    echo Seeding failed.
    pause
    exit /b 1
  )
  popd
)

set "DSPATCH_CHAT_RUN=resume-choice"
set "DSPATCH_CHAT_RESUME=%MODE%"
set "DSPATCH_CHAT_HOLD=1"
set "DSPATCH_CHAT_SWITCH_PROJECTS=%KIT%\projects\A"
set "DSPATCH_CHAT_EXPECT_USERDATA=%KIT%\userData"
set "DSPATCH_CHAT_LOG=%KIT%\hold.json"
set "DSPATCH_SMOKE="
set "DSPATCH_PROBE="
rem The hold-mode close aid is for agents verifying the hand-over; never for this window.
set "DSPATCH_CHAT_HOLD_CLOSE_MS="

echo.
echo Starting DSpatch in the "%MODE%" resume state, SIMULATED by the presentation adapter.
echo   user data:  %KIT%\userData   - not your real DSpatch data
echo   record:     %KIT%\hold.json
echo   reset:      %~nx0 reset
echo The window opens project A and stays open. Close it when you have looked.
echo.
pushd "%APP%"
call npx electron . "--user-data-dir=%KIT%\userData"
popd
endlocal
