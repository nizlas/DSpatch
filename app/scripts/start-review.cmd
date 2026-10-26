@echo off
setlocal
rem DSpatch - the main chat with review beside it, for a person to try (DSP-126, DSP-127).
rem
rem Everything that answers in this window is SIMULATED by the presentation adapters:
rem the chat's replies and the review discussion's replies are canned text produced on
rem this machine, no provider is asked anything, and nothing here says what any model
rem would answer. The review itself (the walk, the diff, your notes) is real: it is read
rem from a small git fixture with two commits.
rem
rem   start-review.cmd          open the window (seeds the kit the first time)
rem   start-review.cmd reset    delete the kit and seed it again first
rem
rem The kit (a seeded user-data directory, project P1 with a three-step review walk and
rem project P2) lives under %TEMP% and is separate from your real DSpatch data. Needs
rem node and git on PATH and "npm run build" done in app\.

set "KIT=%TEMP%\dspatch-review-handover"
set "APP=%~dp0.."

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
  call node --import ./scripts/ts-resolve.mjs scripts/seed-review-kit.mjs "%KIT%" --recent >nul
  if errorlevel 1 (
    popd
    echo Seeding failed.
    pause
    exit /b 1
  )
  popd
)

set "DSPATCH_CHAT_RUN=review-hold"
set "DSPATCH_CHAT_SWITCH_PROJECTS=%KIT%\p1\repo;%KIT%\p2\other"
set "DSPATCH_CHAT_EXPECT_USERDATA=%KIT%\userData"
set "DSPATCH_CHAT_LOG=%KIT%\hold.json"
rem Replies arrive in about three seconds, slowly enough to press Stop.
set "DSPATCH_PRESENTATION_DELTA_MS=200"
set "DSPATCH_REVIEW_PRESENTATION_SEND="
set "DSPATCH_PICK_FILE="
set "DSPATCH_REVIEW_DEFINITION="
set "DSPATCH_CHAT_SHOT="
set "DSPATCH_SMOKE="
set "DSPATCH_PROBE="
rem The hold-mode close aid is for agents verifying the hand-over; never for this window.
set "DSPATCH_CHAT_HOLD_CLOSE_MS="

echo.
echo Starting DSpatch on project P1. Every chat and review answer is SIMULATED by the
echo presentation adapters; no provider is asked anything.
echo   user data:  %KIT%\userData   - not your real DSpatch data
echo   record:     %KIT%\hold.json
echo   reset:      %~nx0 reset
echo Press "Open review" beside "Edit agent loops" to open the walk over P1; use the
echo Discussion tab in its right column to ask about the code. The window stays open
echo until you close it.
echo.
pushd "%APP%"
call npx electron . "--user-data-dir=%KIT%\userData"
popd
endlocal
