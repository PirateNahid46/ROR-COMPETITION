import {
  ref,
  get,
  set,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const { db } = window.rorFirebase;

// State
let activeQuizId = null;
let currentQuiz = null;
let studentPno = "";
let studentPnoKey = "";
let studentRank = "";
let studentName = "";
let studentShip = "";
let selectedAnswers = {};
let timerInterval = null;
let hasSubmitted = false;

// Views
const loginView = document.getElementById("login-view");
const waitingView = document.getElementById("waiting-view");
const quizView = document.getElementById("quiz-view");
const resultView = document.getElementById("result-view");

// Elements
const examTitleBadge = document.getElementById("exam-title-badge");
const timerBox = document.getElementById("timer-box");
const timeRemainingEl = document.getElementById("time-remaining");
const studentPnoInput = document.getElementById("student-pno");
const studentRankSelect = document.getElementById("student-rank");
const studentNameInput = document.getElementById("student-name");
const studentShipInput = document.getElementById("student-ship");
const loginErrorEl = document.getElementById("login-error");

// Load Active Exam Metadata
onValue(ref(db, "activeQuizId"), async (snapshot) => {
  const newQuizId = snapshot.val();
  if (!newQuizId) {
    activeQuizId = null;
    currentQuiz = null;
    examTitleBadge.textContent = "No Scheduled Exam";
    return;
  }

  activeQuizId = newQuizId;
  const quizSnap = await get(ref(db, `quizzes/${activeQuizId}`));
  if (quizSnap.exists()) {
    currentQuiz = quizSnap.val();
    examTitleBadge.textContent = currentQuiz.title;
  }
});

// Competitor Login
document.getElementById("enter-btn").addEventListener("click", async () => {
  loginErrorEl.textContent = "";
  const rawPno = studentPnoInput.value.trim().toUpperCase();
  const rawRank = studentRankSelect.value;
  const rawName = studentNameInput.value.trim();
  const rawShip = studentShipInput.value.trim().toUpperCase();

  if (!rawPno || !rawRank || !rawName || !rawShip) {
    loginErrorEl.textContent = "Please fill in P NO, Rank, Name, and Name of Ship.";
    return;
  }

  studentPno = rawPno;
  studentRank = rawRank;
  studentName = rawName;
  studentShip = rawShip;
  // Sanitize P NO for Firebase key safety
  studentPnoKey = rawPno.replace(/[.#$\[\]\/]/g, "_");

  if (!activeQuizId || !currentQuiz) {
    loginErrorEl.textContent = "No active exam is currently available. Wait for the administrator.";
    return;
  }

  // Check if this P NO already submitted for this exam
  const existingSub = await get(ref(db, `submissions/${activeQuizId}/${studentPnoKey}`));
  if (existingSub.exists()) {
    const data = existingSub.val();
    showResultScreen(
      data.score,
      data.total,
      "You have already completed and submitted this exam.",
      data.pno || studentPno,
      data.rank || studentRank,
      data.name || studentName,
      data.ship || studentShip
    );
    return;
  }

  const now = Date.now();
  if (now >= currentQuiz.endTime) {
    loginErrorEl.textContent = "This exam has already ended.";
    return;
  }

  startExamLifecycle();
});

function startExamLifecycle() {
  switchView(waitingView);
  document.getElementById("lobby-student-pno").textContent = studentPno;
  document.getElementById("lobby-student-rank").textContent = studentRank;
  document.getElementById("lobby-student-name").textContent = studentName;
  document.getElementById("lobby-student-ship").textContent = studentShip;
  document.getElementById("lobby-exam-info").textContent =
    `${currentQuiz.title} • ${currentQuiz.questions.length} Questions • ${currentQuiz.durationMinutes} Minutes`;

  let quizRendered = false;

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const now = Date.now();

    // Phase 1: Waiting for startTime
    if (now < currentQuiz.startTime) {
      const diff = currentQuiz.startTime - now;
      document.getElementById("start-countdown").textContent = formatDuration(diff);
      return;
    }

    // Phase 2: Exam is live
    if (now >= currentQuiz.startTime && now < currentQuiz.endTime) {
      if (!quizRendered) {
        quizRendered = true;
        renderQuizPaper();
        switchView(quizView);
        timerBox.classList.remove("hidden");
      }

      const remaining = currentQuiz.endTime - now;
      timeRemainingEl.textContent = formatDuration(remaining);

      if (remaining <= 60000) {
        timerBox.classList.add("urgent");
      }
      return;
    }

    // Phase 3: Time expired -> Auto-Submit
    if (now >= currentQuiz.endTime && !hasSubmitted) {
      clearInterval(timerInterval);
      submitExam(true);
    }
  }, 500);
}

function renderQuizPaper() {
  document.getElementById("quiz-student-pno").textContent = studentPno;
  document.getElementById("quiz-student-rank").textContent = studentRank;
  document.getElementById("quiz-student-name").textContent = studentName;
  document.getElementById("quiz-student-ship").textContent = studentShip;
  const container = document.getElementById("questions-container");
  updateProgressText();

  const optionLetters = ["A", "B", "C", "D"];

  container.innerHTML = currentQuiz.questions
    .map((q, qIdx) => {
      const optionsHTML = q.options
        .map(
          (optText, optIdx) => `
          <label class="option-label" id="lbl-${qIdx}-${optIdx}">
            <input type="radio" name="q-${qIdx}" value="${optIdx}" onchange="selectOption(${qIdx}, ${optIdx})" />
            <span><strong>${optionLetters[optIdx]}.</strong> ${escapeHTML(optText)}</span>
          </label>
        `
        )
        .join("");

      return `
        <div class="question-card">
          <div class="question-title">${qIdx + 1}. ${escapeHTML(q.question)}</div>
          <div class="options-grid">${optionsHTML}</div>
        </div>
      `;
    })
    .join("");
}

window.selectOption = (qIdx, optIdx) => {
  selectedAnswers[qIdx] = optIdx;

  for (let i = 0; i < 4; i++) {
    const lbl = document.getElementById(`lbl-${qIdx}-${i}`);
    if (lbl) lbl.classList.toggle("selected", i === optIdx);
  }
  updateProgressText();
};

function updateProgressText() {
  const answeredCount = Object.keys(selectedAnswers).length;
  const total = currentQuiz.questions.length;
  document.getElementById("progress-text").textContent = `Answered: ${answeredCount} / ${total}`;
}

// Manual Submit Button
document.getElementById("submit-btn").addEventListener("click", () => {
  const answeredCount = Object.keys(selectedAnswers).length;
  const total = currentQuiz.questions.length;
  const msg =
    answeredCount < total
      ? `You have answered ${answeredCount} of ${total} questions. Submit anyway?`
      : "Are you sure you want to submit your answers?";

  if (confirm(msg)) {
    submitExam(false);
  }
});

// Grade and Save Submission to Firebase
async function submitExam(isAutoSubmit) {
  if (hasSubmitted) return;
  hasSubmitted = true;
  if (timerInterval) clearInterval(timerInterval);
  timerBox.classList.add("hidden");

  let score = 0;
  const total = currentQuiz.questions.length;

  currentQuiz.questions.forEach((q, idx) => {
    if (selectedAnswers[idx] === q.correctIndex) {
      score++;
    }
  });

  try {
    await set(ref(db, `submissions/${activeQuizId}/${studentPnoKey}`), {
      pno: studentPno,
      rank: studentRank,
      name: studentName,
      ship: studentShip,
      score,
      total,
      answers: selectedAnswers,
      autoSubmitted: isAutoSubmit,
      submittedAt: Date.now()
    });
  } catch (err) {
    console.error("Submission error:", err);
  }

  const note = isAutoSubmit
    ? "Time expired! Your answers were automatically submitted."
    : "Your answers have been recorded successfully.";

  showResultScreen(score, total, note, studentPno, studentRank, studentName, studentShip);
}

function showResultScreen(score, total, note, pnoValue, rankValue, nameValue, shipValue) {
  switchView(resultView);
  timerBox.classList.add("hidden");
  document.getElementById("result-student-pno").textContent = pnoValue;
  document.getElementById("result-student-rank").textContent = rankValue;
  document.getElementById("result-student-name").textContent = nameValue;
  document.getElementById("result-student-ship").textContent = shipValue;
  document.getElementById("score-display").textContent = `${score} / ${total}`;
  const pct = total > 0 ? ((score / total) * 100).toFixed(1) : 0;
  document.getElementById("percent-display").textContent = `${pct}%`;
  document.getElementById("result-note").textContent = note;
}

function switchView(target) {
  [loginView, waitingView, quizView, resultView].forEach((el) => el.classList.add("hidden"));
  target.classList.remove("hidden");
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}