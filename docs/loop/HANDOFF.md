# Överlämning mellan koordinator och specialist

Koordinatorn skickar ett avgränsat uppdrag med följande uppgifter. Använd kort text och exakta filer eller rubriker; dumpa inte hela chatthistoriken.

## Uppdrag

- **Identitet:** run-id, task-id och call-id. Call-id är journalens nummer; runtime-agent-ID sparas separat när det finns.
- **Roll och läge:** specialistnamn, exempelvis Reviewer i plan- eller implementationsläge.
- **Mål och nytta:** vad som ska uppnås och varför det behövs nu.
- **Mandat och gränser:** tillåtna skrivytor, möjliga kommandon och vad som ligger utanför uppdraget. Ange om det gäller ett isolerat kalibreringsrepo.
- **Aktuella beslut:** relevant användarstyrning i klartext, inklusive korrigeringar sedan föregående försök.
- **Underlag:** relevant VISION-avsnitt, aktuell uppgiftsfil, kod och tidigare rapporter. Läs AGENTS.md.
- **Startläge:** gren, basrevision, befintliga ändringar och kandidatens snapshot om den är fastställd.
- **Bedömning:** kriterier som gäller, vilken kontroll som behövs och vad som kräver mänsklig återkoppling.
- **Leverans:** slutsvar till koordinatorn; eventuell uttryckligen tillåten loggkatalog. Inga egna delegeringar.

Specialisten ska kontrollera en materiell motsägelse eller saknat mandat med koordinatorn. Den får göra normala reversibla val inom ett tydligt uppdrag.

## Slutsvar

Ange:

1. **Resultat:** COMPLETE, PARTIAL, BLOCKED eller NEEDS_DECISION för ditt uppdrag, aldrig automatiskt för hela backloguppgiften.
2. **Underlag:** vad du faktiskt läst eller kontrollerat, relevant kandidat-/rapportreferens.
3. **Leverans:** ändrade filer, förslag eller slutsats; varför detta löser den avgränsade uppgiften.
4. **Evidens:** utförda kontroller, kommandon, exitkoder och loggar. Skilj egna observationer från dokumentation och antaganden. Verifier använder PASS/FAIL/NOT_RUN/HUMAN_PENDING per kriterium; Reviewer använder ACCEPT/REWORK/NEEDS_DECISION.
5. **Kvarstående:** osäkerheter, processer med oklart utfall, relevanta risker och mänskliga bedömningar.
6. **Nästa steg:** konkret föreslagen handling och vem som behöver göra den.

Svara så kort som underlaget tillåter. Länka till råloggar som finns, men ersätt inte viktiga fynd med ”se loggen”. Koordinatorn sparar rapporten och returnerar samma relevanta sammanhang vid ett omtag.

## Journalens aktiva anrop

Före delegering sätter koordinatorn `active_call` till ett objekt med `call_id`, `role`, `started_at_utc`, `runtime_agent_id` (initialt null), `outcome` (initialt `unknown`) och `handoff_path`. Anropsräknaren ökas före start. Vid känt avslut sparas rapporten, steget förs till `completed_steps` och `active_call` blir null. Vid avbrott med oklart utfall behålls objektet för avstämning; räknare eller tidigare rapporter nollställs inte.
