# Uppgiftsstyrt modellval i utvecklingsloopen

Förslag, 13 september 2026, utifrån Niclas önskemål. Införandet följs i [DSP-8](../backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md). Detta beskriver en kommande förbättring av loopen som bygger DSpatch; det är inte en implementerad modellväljare eller ett nytt krav för produktens Etapp 0.

## Mål och nuvarande läge

Koordinatorn ska kunna välja modell och resonemangsnivå efter det konkreta uppdragets karaktär, komplexitet och osäkerhet. Agentrollen anger ansvar och behörigheter; den ska inte ensam avgöra modellvalet. Samma Implementer kan behöva olika modeller för en enkel textändring och för ett svårt samtidighetsfel.

Alla fem nuvarande specialistdefinitioner använder `model: inherit`. Den pågående DSP-7-kalibreringen fortsätter med denna baslinje, även efter paus och resume. Förslaget aktiverar inga modellbyten. DSP-1 kan genomföras efter DSP-7 utan att vänta på DSP-8.

## Föreslagen bedömning inför ett anrop

Gör bedömningen i koordinatorns befintliga planering; skapa inte ett extra agentanrop bara för att välja modell. Utgå från uppdraget, det tillgängliga underlaget och relevanta tidigare resultat.

| Uppdragets karaktär | Vad som bör styra valet |
| --- | --- |
| Tydlig, lokal ändring med entydig kontroll | En snabbare modell kan räcka om den visat tillräcklig kvalitet för liknande arbete. |
| Normal implementation över flera berörda delar | Förmåga att förstå beroenden och använda verktyg, vägd mot tid och kostnad. |
| Arkitektur, svår felsökning eller oklara antaganden | Större resonemangskapacitet och vid behov högre effort, redan från första anropet. |
| Granskning | Ändringens osäkerhet och konsekvens om ett fel missas. En kort diff är inte automatiskt enkel att granska. |
| Research | Frågans svårighet, källornas kvalitet, kontextbehov och tillgängliga verktyg. |

Välj bland modeller som är tillgängliga och tillåtna i den aktuella miljön. Första förslaget kan använda ett fåtal profiler för snabbare, balanserat och fördjupat arbete, kopplade till verifierade modell-ID:n och inställningar. Håll den gemensamma rollinstruktionen samlad om flera profiler för samma roll behövs. En profil är ett prövbart val, inte en generell rangordning av modeller.

Modellnamn, marknadsföring eller modellens egen säkerhet i svaret räcker inte som belägg för lämplighet. Kontextutrymme, verktygsstöd, lokala erfarenheter och uppdragets kvalitetskrav ska vägas in. En annan modell för review kan provas, men ersätter inte oberoende underlag och verifiering.

Optimera arbetet till ett godkänt resultat: kvalitet, tid, omtag och kostnad tillsammans. En låg tokenkostnad är inte en besparing om flera extra försök behövs. Okända kostnader eller saknade mätvärden ska framgå.

## Fast modell och ökad kapacitet

Niclas ska kunna ange en fast modell för ett pass eller ett uppdrag. Det valet går före automatiken. Håll samma val vid resume om inte användaren ändrar det eller ett byte ryms i ett redan angivet mandat. Tillgänglighet, behörigheter och eventuella resursramar ska respekteras; modellvalet ger ingen utökad åtkomst.

När ett resultat är otillräckligt ska koordinatorn först skilja mellan ett fel i instruktionen, saknat underlag, verktygsfel och ett problem som rimligen kräver mer resonemang. Lös rätt problem. Ett blockerat MCP-anrop eller okänt utfall ska inte behandlas som att en större modell automatiskt behövs.

Ett motiverat byte får gälla nästa anrop eller ett avgränsat omtag efter att föregående utfall klarlagts. Bevara arbetskopia, kandidat, tidigare rapporter och passets befintliga anrops- och omtagsräknare. Modellbyte nollställer inte gränser eller återupprepar redan utfört arbete. Den nya agenten får den information den behöver för att fortsätta.

## Vad Cursor-stödet behöver bevisa

[Cursor dokumenterar](https://cursor.com/docs/subagents#model-configuration) `model: inherit`, ett bestämt modell-ID per agentdefinition och modellparametrar, exempelvis effort. Kontots villkor och modellåtkomst kan påverka utfallet. Dokumentationen är läst 13 september 2026.

Detta bevisar inte att huvudagentens tillgängliga anropsverktyg kan välja ett godtyckligt modell-ID per anrop. DSP-8 behöver kontrollera den faktiska Cursor-miljön och prova den stödda vägen. Om direkt modellval inte stöds kan valet mellan fördefinierade agentprofiler utvärderas. Dynamisk omskrivning av agentfiler under ett pågående pass får inte antas fungera; upptäckt och inläsning måste i så fall vara verifierade.

Om inget tillförlitligt automatiskt val kan visas: rapportera hindret och behåll ett dokumenterat fast modellval. Ett förslag i chatten räknas inte som ett utfört modellbyte. DSP-8:s automatiska funktion ska då förbli ej klar, och nästa avgränsade åtgärd ska framgå.

## Insyn och första utvärdering

Före varje valt anrop ska journalen kunna ange roll, uppdrag, föreslagen modell och effort, kort motiv samt om valet är automatiskt eller fast. Efteråt ska den skilja begärt modellval från bekräftad faktisk modell/effort, med källa, anropsreferens, utfall, tid och tillgänglig förbrukning. Saknade runtime-uppgifter är okända; agentens egen identitetsuppgift är inte oberoende bekräftelse.

Visa en kort förklaring i översikten, exempelvis ”Fördjupat resonemang för ett fel med oklara samtidighetsberoenden”. Detaljer och mätvärden hör till journalen. Niclas ska kunna förstå och ändra valet utan att behöva styra varje anrop.

Det första provet jämför en enkel ändring, en uppgift med tydlig osäkerhet och en granskning med ett fast modellval som referens. Håll underlag och kriterier jämförbara och inkludera två olika uppdrag inom samma roll. Bedöm planeringskvalitet, verifierat resultat, nödvändiga omtag, tidsåtgång och tillgängliga kostnadsdata. Dokumentera begränsningarna; ett litet prov visar inte en generell vinnare.
