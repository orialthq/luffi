# Luffi research: capture → understanding → action, and proactive timing (as of 2026-09-29)

I ran about 52 web searches before the session's search budget ran out, then read primary sources directly (papers, Apple and Android docs, repos, reviews). I could not load the Heyday, Glasp or Perplexity Comet pages, so I have not verified their proactive features.

## 1. Product teardown

| Product | How it works | What is proactive | What users praise or complain about |
|---|---|---|---|
| **Pixel Screenshots** | Gemini Nano writes a summary and tags. Tapping the bell sets a reminder. It suggests calendar events. Saved restaurants resurface later as Maps suggestions ([blog.google](https://blog.google/products-and-platforms/devices/pixel/google-pixel-screenshots-tips/)). | Suggests a reminder or event when you capture; brings items back inside other apps | Search works well, but extracted facts are wrong: bad prices and invented dates. Only 300 of 1,800 screenshots were processed because of throttling ([AA 2024-09-11](https://www.androidauthority.com/pixel-screenshots-review-3476772/)). Date and app filters only arrived after two years, and users were unhappy when some processing moved to the cloud ([AA 2026-08-18](https://www.androidauthority.com/google-pixel-screenshots-filters-update-3699697/)). A "Remember this with Gemini" share-sheet shortcut has been found in code but is not released ([AA 2026-08-19](https://www.androidauthority.com/gemini-share-sheet-remember-screenshot-details-apk-teardown-3700453/)). |
| **Magic Cue, being renamed "Gemini Proactive Assistance"** | Gemini Nano on the device reads the screen, notifications, Gmail, Calendar and Messages ([9to5G 2026-07-09](https://9to5google.com/2026/07/09/pixel-magic-cue-gemini/)) | Fully unprompted suggestion chips | In a month of testing it never appeared in everyday texts and once showed a past flight instead of the upcoming one ([AA 2025-09-20](https://www.androidauthority.com/google-pixel-10-magic-cue-one-month-later-3598684/)). The first useful cue came after about four months ([MobileSyrup 2026-01-07](https://mobilesyrup.com/2026/01/07/whoa-my-pixels-magic-cue-finally-did-something-useful/)). |
| **Pixel Daily Hub; Samsung Now Brief / Now Nudge** | Galaxy S26 keeps personal data on the device (Personal Data Engine). Nudge offers photos when a friend asks for them and flags calendar conflicts ([Samsung 2026-02-26](https://samsungmobilepress.com/articles/samsung-unveils-galaxy-s26-series-intuitive-galaxy-ai)). | Morning brief; reminders for reservations and travel | Daily Hub is called "junk filler" ([Droid-Life 2025-08-29](https://www.droid-life.com/2025/08/29/googles-daily-hub-on-the-pixel-10-is-pretty-disappointing-so-far/)). Now Brief is criticized for low accuracy, and its "richer insights" option shares data with partners (Sammy Fans 2026-03-22). |
| **Apple iOS 26 Visual Intelligence** | Screenshots open full screen with Add to Calendar, image search and Ask ChatGPT; needs iPhone 15 Pro or newer ([9to5Mac 2026-01-11](https://9to5mac.com/2026/01/11/ios-26-new-screenshot-apple-intelligence-favorite-feature/)) | Nothing proactive; the user taps once | Reviewer "yet to see it fail" on events. Third-party apps can appear in its image search through App Intents `IntentValueQuery`, and events it creates land in EventKit ([WWDC26 session 297](https://developer.apple.com/videos/play/wwdc2026/297/)). |
| **Nothing Essential Space** | A hardware key captures the screen plus a voice note; AI writes a summary and tasks; syncs to Google Calendar ([GSMArena 2025-07-18](https://www.gsmarena.com/nothing_essential_space_updates-news-68683.php)) | Generates reminders automatically | "It often forgets to tell you to do anything with that task"; clutter builds and the reviewer stopped using it ([9to5G 2025-12-31](https://9to5google.com/2025/12/31/nothing-phone-3-review-2025s-most-polarizing-phone/)). Takes about a minute and results are inconsistent ([Beebom 2025-03-21](https://beebom.com/nothing-essential-key-makes-reminders-easy-and-confusing/)). |
| **Microsoft Recall** | Takes snapshots when the screen changes; OCR runs locally; Click to Do offers actions ([MS Learn](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/recall/)) | None | Retrieval "nailed it", but Click to Do is "underbaked" and it missed one banking screen ([MakeUseOf 2026-05-21](https://www.makeuseof.com/microsoft-controversial-recall-feature-more-practical-than-i-expected/)). |
| **Rewind / Limitless** | Meta bought it on 2025-12-05 and shut Rewind on 2025-12-19 ([WinBuzzer](https://winbuzzer.com/2025/12/05/meta-acquires-ai-wearables-startup-limitless-kills-pendant-sales-and-sunsets-rewind-app-xcxwbn/)) | — | No successor product |
| **Mem Agent** | Reads notes and calendar; "waits when you're busy" and retries the next morning with a draft ([mem.ai](https://get.mem.ai/product/agent)) | Follow-ups timed to the calendar | No reception data found |
| **Sorti, Fabric, Recall (recall.it)** | Capture through the share sheet; AI auto-sorts into recipe cards, price tracking and similar ([letitsorti.com](https://letitsorti.com/)). Fabric sends weekly recap emails. Recall uses spaced repetition over a graph. | Only recaps and review schedules | Organization is praised. None of them suggests tasks by place or time. |
| **ChatGPT Pulse** | Researches overnight using chats, memory and connected apps. Shows 5–10 cards, then says "that's it for today". Thumbs up/down feedback ([TechCrunch 2025-09-25](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)). | Daily brief | Shut down on 2026-06-17 "as proactive updates move into scheduled tasks", which the user controls ([summary](https://justinmckelvey.com/blog/chatgpt-pulse)). |
| **Claude memory** | Memory kept per project; the user can view and edit the summary; incognito mode ([claude.com](https://claude.com/blog/memory), Sep/Oct 2025) | None | The useful pattern is memory the user can see and edit. |
| **Meta AI Studio bots** | Follow up only if the user sent at least 5 messages within 14 days, and stop after one unanswered follow-up ([TechCrunch 2025-07-03](https://techcrunch.com/2025/07/03/meta-has-found-another-way-to-keep-you-engaged-chatbots-that-message-you-first/)) | Unprompted messages | A good template for a hard cap |
| **Kakao: Kanana in KakaoTalk** | On-device "Kanana Nano" reads chat context. Sends a first-message ("선톡") morning schedule brief. Suggests places, with a booking button ([etnews 2026-03-22](https://www.etnews.com/20260320000219); [MS Today 2026-09-17](https://www.mstoday.co.kr/news/articleView.html?idxno=102641)). | Messages the user first | Reviewer calls it different from rivals but early. The standalone Kanana app was folded into KakaoTalk in Sep 2026. |
| **Naver shopping agent** | Uses clicks, wishlist (찜), cart, location and desired delivery date ([Nate 2026-06-01](https://m.news.nate.com/view/20260601n31090)) | Starts conversations since June 2026 | Monthly users and conversations up 5×, daily transactions up 4× since March ([fnnews 2026-09-27](https://www.fnnews.com/news/202609270633124595)) |

The failure pattern is consistent. Capture apps fail by never acting on what they saved (Essential Space, Pixel Screenshots). Proactive assistants fail by rarely firing or firing wrongly (Magic Cue, Now Brief, Daily Hub). No product combines a graph of saved intents with place and time triggers, and that is Luffi's opening. I found no relevant feature in Toss.

## 2. Best open source to borrow from

- **[thunlp/ProactiveAgent](https://github.com/thunlp/ProactiveAgent)** (Apache-2.0). Labels suggestions as accept, reject or ignore and trains a reward model (F1 0.918) that decides whether to propose. Borrow both the labeling scheme and the "reward model as gate" idea.
- **[LangChain agent-inbox](https://github.com/langchain-ai/agent-inbox)** with LangGraph interrupts. Its three patterns map onto Luffi: notify (deadlines), question (capture purpose), review (TaskBoard replans) ([blog 2025-01-14](https://www.langchain.com/blog/introducing-ambient-agents)).
- **Mem0 proactive memory patterns.** A yes/no classifier decides whether to surface memory at all, and surfacing is limited to "one per significant context shift" ([mem0 blog](https://mem0.ai/blog/proactive-memory-in-ai-agents-a-developer-s-guide)).
- **[screenpipe](https://github.com/screenpipe/screenpipe)** (21.8k stars). Its license is source-available and commercial, so use it as a reference only. Useful ideas: capture driven by events (app switch, typing pause), scheduled agents defined in markdown files, SQLite full-text search.
- **[Shots Studio](https://github.com/AnsahMohammad/shots-studio)** (GPL-3.0, Android). The closest analog: tags screenshots with on-device Gemma or the Gemini API. Study it but do not copy code into a proprietary app.
- **OpenRecall and Windrecorder.** Index only when screen content changes; OCR plus embeddings.
- **PRPF ([arXiv 2606.03236](https://arxiv.org/abs/2606.03236)) and ContextAgent (NeurIPS'25).** Run a cheap gate model first and call the expensive reasoner only when it passes. This reduces false triggers.
- **Evaluation data:** Duolingo's dataset of 200M notifications, and ProAgentBench's 28k events for testing "when to help".

## 3. Recommended design for Luffi

The thresholds below are my starting values, not numbers taken from the sources. Tune them on real data.

### 3a. Inferring capture purpose

**Categories:** cook, visit, buy, compare, gift, event/deadline, reference, inspiration.

**Signals to use:**
- Text read from the image: price, date, address, ingredients, opening hours.
- Source app or URL (Instagram vs. Coupang vs. Naver Map).
- The user's caption or voice note.
- Bursts: 3 or more captures of the same item or category within 10 minutes suggests comparing or buying.
- The same place or product saved more than once.
- Links to live TaskBoards or the calendar (a Jeju trip on the calendar plus a Jeju restaurant capture means trip planning).
- Whether this user has acted on this category before.
- Time of capture.

**When to ask** (based on Horvitz's act / ask / do-nothing thresholds, [CHI'99](https://erichorvitz.com/chi99horvitz.pdf)):
- If the most likely purpose has probability 0.75 or higher, assign it silently and show a chip the user can edit.
- If it is between 0.45 and 0.75 and the candidate purposes lead to different actions, ask with one-tap chips: 2–3 options plus "그냥 저장".
- Otherwise default to "inspiration" and ask nothing.

**How uncertainty is measured:** Use entropy over sampled intents ("intent-sim"). In that paper, spending clarification on just 10% of cases doubled the gain compared with asking at random ([Zhang & Choi, arXiv 2311.09469](https://arxiv.org/abs/2311.09469)).

**How to ask:** Batch questions into an in-app "정리" card, never a push notification. Allow at most about 3 questions a day.

**Trust:** Never show a price or date that the image text does not support; show the source crop next to it. This is the lesson from Pixel Screenshots.

### 3b. When to suggest

**Triggers:**
- **Place:** geofence the marts the user actually visits plus their top saved places. Require the user to stay 3–5 minutes (Android's dwell transition) so drive-bys don't fire. Use a radius of at least 100–150 m.
- **Deadline:** coupon expiry, event date, pop-up store closing. Fire two days before and on the day, at the hour the user usually opens the app.
- **Routine windows:** learned from app opens and past acceptances, for example Saturday 10:00 for meal planning.
- **Context change:** when budget, dates or completions change, replan the TaskBoard. Push only if something the user committed to breaks.

**Scoring:** P(accept | user, purpose, trigger, context) × (urgency + value of missing items) − interruption cost. The cheap scorer runs on the device, and the LLM writes the message only after the scorer passes.

**Delivery:**
- Push only when the score clears a push threshold; everything else becomes an in-app card or widget.
- Set the push threshold so expected acceptance is about 15–20%. For reference, a phone-usage model raised engagement from a 4.3% baseline to 7.1%, and adding the user's own past behavior pushed predictions up to 21.8% ([Pielot 2017](https://pielot.org/pubs/Pielot2017-UbiComp-Engagement.pdf)).

**Caps:**
- At most 1 push a day and 4 a week. Vendor surveys suggest 2–5 pushes a week makes many users disable notifications ([Business of Apps](https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/)); treat that as weak evidence.
- Pause a category after 2 ignores in a row (Meta stops after one unanswered follow-up).
- Show a finite daily list ending "오늘은 여기까지", as Pulse did.

**Moments:** deliver at natural breaks such as unlocking the phone or opening the app, not mid-activity.
- In an IDE field study, suggestions at workflow boundaries got 52% engagement, while mid-task ones were dismissed 62% of the time ([Kuo et al., IUI'26](https://arxiv.org/abs/2601.10253)).
- Delivering at activity breaks roughly halved response time, from 54.3 to 27.3 minutes, across about 680k users ([survey, arXiv 1711.10171](https://arxiv.org/html/1711.10171v2)).
- ProAgentBench: the clues that someone will need help show up minutes before they do. Knowledge-graph memory improved timing accuracy by 11.8%. The best model scored only F1 69.5% with precision 60.8%, so a gate is necessary ([arXiv 2602.04482](https://arxiv.org/html/2602.04482v2)).

### 3c. Learning from accept and reject

**Outcome labels:**
- **Accept = 1:** a tap followed by a real action (opened the map, checked off an ingredient, added to a TaskBoard).
- **"Not interested" = 0**, full weight.
- **Swipe dismiss = 0**, half weight.
- **Ignored or expired = 0**, quarter weight.
- **"Wrong purpose"** retrains the purpose classifier instead of the timing model.
- **Snooze** shifts the time window.

**Success window:** count an action as a success if it happens within 2 hours, or during the visit for place triggers. This follows Duolingo's reward definition ([KDD'20](https://research.duolingo.com/papers/yancey.kdd20.pdf)).

**Model:**
- Keep a Beta score per (user × purpose × trigger type), seeded from the population rate with a strength of about 10.
- Use Thompson sampling across candidate suggestions, including a "send nothing" option.
- Add a Duolingo-style penalty for repeating the same template (γ≈0.017, half-life 15 days). That method gave +0.5% daily active users and +2% new-user retention.
- Once a user has about 50 labeled outcomes, switch to a contextual bandit with features: hour, weekday, distance, days since capture, deadline, category.
- Save explicit rejections as preference memories. A 2026 study adapted a population model to each user on the device from accept/reject/ignore feedback and matched RLHF. Participants rejected suggestions that came "too early" or "too late" ([arXiv 2602.04000](https://arxiv.org/pdf/2602.04000)).

**Metrics to track:** acceptance rate, how often Luffi proposes at all ([PARE](https://huggingface.co/papers/2604.00842)), and how often users mute a category or disable notifications.

## 4. iOS and Android feasibility

### iOS
- **No background hook for new screenshots.** `PHPhotoLibraryChangeObserver` fires only while the app is running ([Apple forums](https://developer.apple.com/forums/thread/696678)).
- **Catching up:** on each launch or background refresh, read changes since a saved `PHPersistentChangeToken` (iOS 16+, [WWDC22](https://developer.apple.com/videos/play/wwdc2022/10132/)) and filter for screenshots. The token can expire (error 3105), so keep a full-rescan fallback. This needs full photo access; with limited access the app sees only the photos the user picked.
- **Shortcuts:** Apple's guide lists a Screenshot automation trigger (Photos, Files or Clipboard) ([Apple](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios)), reported as new in iOS 27. **Unverified:** whether it can run without asking and pass the image to Luffi's App Intent. Test this. Back Tap can also run a shortcut.
- **Share Extension** is the most reliable path, and the link comes with the share. I could not verify the extension memory limit (commonly said to be about 120 MB), so hand work off to the main app or a background upload through a shared container.
- **Background tasks:** App refresh gets about 30 seconds and runs when the system decides, based on usage. Processing tasks run when the device is idle and charging. iOS 26's continued-processing task only covers work the user started ([Apple](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app)). **Unverified:** that force-quitting the app blocks these tasks.
- **iOS 26.1 background upload extension** is meant for photo backup apps. **Unverified** whether it could be used to feed screenshots to Luffi, and it is an App Review risk ([9to5Mac](https://9to5mac.com/2025/10/24/ios-26-1-third-party-photos-backup-background/)).
- **Geofencing:** 20 regions per app, and the newer CLMonitor API has the same limit. Events fire after the user crosses the boundary and stays about 20 seconds; the app is relaunched with about 10 seconds to run ([Apple](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html)). Work around it by monitoring the nearest ~19 places plus one large "re-center" region.
- **On-device AI:** Apple's WWDC26 Foundation Models update adds image input and on-device OCR tools. Private Cloud Compute is free for small businesses under 2M downloads ([Apple](https://developer.apple.com/wwdc26/guides/apple-intelligence/)).

### Android
- **Detecting new screenshots:** the new-picture broadcast was removed in Android 7. Instead, schedule a job that triggers on changes to the MediaStore images collection (JobScheduler or WorkManager content-URI trigger). It must be rescheduled after every callback, cannot be periodic or survive reboot, and must be re-registered at boot ([docs](https://developer.android.com/topic/performance/background-optimization.html)).
- **Android 14 screenshot callback:** works only for your own visible screen and gives no file, so it is useless for Luffi ([docs](https://developer.android.com/about/versions/14/features/screenshot-detection)).
- **Permission and Play policy:** reading all photos requires `READ_MEDIA_IMAGES`. Play policy allows that only when broad photo access is core functionality, with full compliance required since 2025-05-28 ([Play](https://support.google.com/googleplay/android-developer/answer/14115180)). Luffi needs a strong justification plus a fallback to the photo picker and share sheet. Android 14's partial access shows only the photos the user selected.
- **Background job limits:** by standby bucket, regular jobs get 20 minutes per hour (active) down to 10 minutes per day (rare); restricted apps run once a day ([docs](https://developer.android.com/topic/performance/power/power-details)). Android 16 enforces these quotas more strictly ([docs](https://developer.android.com/about/versions/16/behavior-changes-all)).
- **Geofencing:** 100 per app per user. Use a radius of at least 100–150 m. Latency is under 2 minutes normally, 2–3 minutes under background limits, and about 6 minutes when the device is stationary. Needs background location permission, and geofences must be re-registered after reboot ([docs](https://developer.android.com/develop/sensors-and-location/location/geofencing)).

**Also unverified:** the specific limits in OpenAI's scheduled tasks (runs at most hourly, auto-pauses when unused), which come from a secondary source ([yellow.com](https://yellow.com/news/chatgpt-pulse-scheduled-tasks-hub)); Khoj's license; and Heyday, Glasp and Comet's proactive features.
