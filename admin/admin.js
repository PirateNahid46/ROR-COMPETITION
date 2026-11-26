import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  push,
  set,
  update,
  onValue,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const { auth, db } = window.rorFirebase;
const ADMIN_DOMAIN = "";

// State
let allQuizzes = {};
let draftQuestions = [];
let editingQuizId = null;
let editingQuestionIndex = null;
let activeQuizId = null;
let selectedQuizIdForResults = null;
let currentResultsCache = [];
let listenersInitialized = false;

// Auth Elements
const authView = document.getElementById("auth-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const adminIdInput = document.getElementById("admin-id");
const adminPassInput = document.getElementById("admin-password");
const authErrorEl = document.getElementById("auth-error");
const adminUserLabel = document.getElementById("admin-user-label");

// Builder Elements
const builderHeading = document.getElementById("builder-heading");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const quizTitleInput = document.getElementById("quiz-title");
const startTimeInput = document.getElementById("start-time");
const durationInput = document.getElementById("duration");

const questionFormHeading = document.getElementById("question-form-heading");
const cancelQEditBtn = document.getElementById("cancel-q-edit-btn");
const qTextInput = document.getElementById("q-text");
const optInputs = [
  document.getElementById("opt-0"),
  document.getElementById("opt-1"),
  document.getElementById("opt-2"),
  document.getElementById("opt-3")
];
const correctOptSelect = document.getElementById("correct-opt");
const addQuestionBtn = document.getElementById("add-question-btn");
const draftListEl = document.getElementById("draft-list");
const saveQuizBtn = document.getElementById("save-quiz-btn");

// Start & Results Elements
const quizzesListEl = document.getElementById("quizzes-list");
const activeStatusEl = document.getElementById("active-status");
const resultsExamSelect = document.getElementById("results-exam-select");
const resultsSubtitle = document.getElementById("results-subtitle");
const resultsTbody = document.getElementById("results-tbody");

// Tab Switching
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function switchTab(tabId) {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  tabPanels.forEach((panel) => panel.classList.toggle("hidden", panel.id !== tabId));
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// Admin Sign-In
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authErrorEl.textContent = "";

  let rawId = adminIdInput.value.trim();
  const password = adminPassInput.value;

  if (!rawId.includes("@") && ADMIN_DOMAIN) {
    rawId = `${rawId}${ADMIN_DOMAIN}`;
  }

  try {
    await signInWithEmailAndPassword(auth, rawId, password);
    adminPassInput.value = "";
  } catch (err) {
    authErrorEl.textContent = "Invalid Admin ID or password.";
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    authView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    adminUserLabel.textContent = user.email;
    if (!listenersInitialized) {
      initDatabaseListeners();
      listenersInitialized = true;
    }
  } else {
    dashboardView.classList.add("hidden");
    authView.classList.remove("hidden");
  }
});

// Add or Update Question in Draft List
addQuestionBtn.addEventListener("click", () => {
  const question = qTextInput.value.trim();
  const options = optInputs.map((input) => input.value.trim());
  const correctIndex = parseInt(correctOptSelect.value, 10);

  if (!question || options.some((opt) => !opt)) {
    alert("Please fill in the question text and all 4 options.");
    return;
  }

  if (editingQuestionIndex !== null) {
    draftQuestions[editingQuestionIndex] = { question, options, correctIndex };
    resetQuestionForm();
  } else {
    draftQuestions.push({ question, options, correctIndex });
    resetQuestionForm();
  }

  renderDraftQuestions();
});

cancelQEditBtn.addEventListener("click", resetQuestionForm);

function resetQuestionForm() {
  editingQuestionIndex = null;
  questionFormHeading.textContent = "Add Question (4-Option MCQ)";
  addQuestionBtn.textContent = "+ Add Question to Exam";
  cancelQEditBtn.classList.add("hidden");
  qTextInput.value = "";
  optInputs.forEach((input) => (input.value = ""));
  correctOptSelect.value = "0";
}

window.editDraftQuestion = (index) => {
  const q = draftQuestions[index];
  if (!q) return;
  editingQuestionIndex = index;
  questionFormHeading.textContent = `Editing Question #${index + 1}`;
  addQuestionBtn.textContent = "Save Question Changes";
  cancelQEditBtn.classList.remove("hidden");

  qTextInput.value = q.question;
  q.options.forEach((opt, i) => {
    if (optInputs[i]) optInputs[i].value = opt;
  });
  correctOptSelect.value = String(q.correctIndex);
  qTextInput.focus();
};

window.removeDraft = (index) => {
  if (editingQuestionIndex === index) resetQuestionForm();
  draftQuestions.splice(index, 1);
  renderDraftQuestions();
};

function renderDraftQuestions() {
  if (draftQuestions.length === 0) {
    draftListEl.innerHTML = "";
    return;
  }

  const labels = ["A", "B", "C", "D"];
  draftListEl.innerHTML = draftQuestions
    .map(
      (q, idx) => `
      <div class="draft-item">
        <div>
          <strong>Q${idx + 1}:</strong> ${escapeHTML(q.question)}
          <small>Correct: ${labels[q.correctIndex]} — ${escapeHTML(q.options[q.correctIndex])}</small>
        </div>
        <div class="draft-item-actions">
          <button class="btn small secondary" onclick="editDraftQuestion(${idx})">Edit</button>
          <button class="btn danger" onclick="removeDraft(${idx})">Remove</button>
        </div>
      </div>
    `
    )
    .join("");
}

// Cancel Exam Edit Mode
cancelEditBtn.addEventListener("click", resetExamBuilder);

function resetExamBuilder() {
  editingQuizId = null;
  builderHeading.textContent = "Create New ROR Exam";
  saveQuizBtn.textContent = "Publish & Set as Active Exam";
  cancelEditBtn.classList.add("hidden");
  quizTitleInput.value = "";
  startTimeInput.value = "";
  durationInput.value = "15";
  draftQuestions = [];
  resetQuestionForm();
  renderDraftQuestions();
}

// Save New or Edited Quiz to Firebase
saveQuizBtn.addEventListener("click", async () => {
  const title = quizTitleInput.value.trim();
  const startTimeVal = startTimeInput.value;
  const durationMinutes = parseInt(durationInput.value, 10);

  if (!title || !startTimeVal || !durationMinutes || durationMinutes <= 0) {
    alert("Please provide the Exam Title, Start Time, and a valid Duration.");
    return;
  }

  if (draftQuestions.length === 0) {
    alert("Please add at least one MCQ question before saving.");
    return;
  }

  const startTimestamp = new Date(startTimeVal).getTime();
  const endTimestamp = startTimestamp + durationMinutes * 60 * 1000;

  if (editingQuizId) {
    await update(ref(db, `quizzes/${editingQuizId}`), {
      title,
      startTime: startTimestamp,
      endTime: endTimestamp,
      durationMinutes,
      questions: draftQuestions,
      updatedAt: Date.now()
    });
    alert("Exam updated successfully!");
    resetExamBuilder();
    switchTab("tab-start");
  } else {
    const newQuizRef = push(ref(db, "quizzes"));
    await set(newQuizRef, {
      title,
      startTime: startTimestamp,
      endTime: endTimestamp,
      durationMinutes,
      questions: draftQuestions,
      createdAt: Date.now()
    });
    await set(ref(db, "activeQuizId"), newQuizRef.key);
    alert("Exam published and set as Active!");
    resetExamBuilder();
    switchTab("tab-start");
  }
});

// Load an existing exam into the Builder tab for editing
window.loadExamForEdit = (id) => {
  const quiz = allQuizzes[id];
  if (!quiz) return;

  editingQuizId = id;
  builderHeading.textContent = `Editing Exam: ${quiz.title}`;
  saveQuizBtn.textContent = "Save Exam Changes";
  cancelEditBtn.classList.remove("hidden");

  quizTitleInput.value = quiz.title;
  startTimeInput.value = toLocalDateTimeInput(quiz.startTime);
  durationInput.value = quiz.durationMinutes;
  draftQuestions = JSON.parse(JSON.stringify(quiz.questions || []));

  resetQuestionForm();
  renderDraftQuestions();
  switchTab("tab-builder");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// Database Listeners
function initDatabaseListeners() {
  onValue(ref(db, "activeQuizId"), (snapshot) => {
    activeQuizId = snapshot.val();
    updateActiveStatusBanner();
    renderExamCards();
    if (activeQuizId && !selectedQuizIdForResults) {
      selectExamForResults(activeQuizId);
    }
  });

  onValue(ref(db, "quizzes"), (snapshot) => {
    allQuizzes = snapshot.val() || {};
    updateActiveStatusBanner();
    renderExamCards();
    populateResultsSelector();
  });
}

function updateActiveStatusBanner() {
  if (activeQuizId && allQuizzes[activeQuizId]) {
    activeStatusEl.textContent = `Active: ${allQuizzes[activeQuizId].title}`;
  } else {
    activeStatusEl.textContent = "No Active Exam";
  }
}

function renderExamCards() {
  const entries = Object.entries(allQuizzes).reverse();
  if (entries.length === 0) {
    quizzesListEl.innerHTML = `<p class="muted">No exams created yet. Use the "Create / Edit Exam" tab to build one.</p>`;
    return;
  }

  quizzesListEl.innerHTML = entries
    .map(([id, quiz]) => {
      const isActive = id === activeQuizId;
      const startStr = new Date(quiz.startTime).toLocaleString();
      const endStr = new Date(quiz.endTime).toLocaleTimeString();
      const inputVal = toLocalDateTimeInput(quiz.startTime);

      return `
        <div class="quiz-card ${isActive ? "active" : ""}">
          <div>
            <div class="quiz-card-header">
              <span class="quiz-card-title">${escapeHTML(quiz.title)}</span>
              ${isActive ? `<span class="active-tag">ACTIVE EXAM</span>` : ""}
            </div>
            <div class="quiz-meta" style="margin-top: 0.45rem;">
              <div><strong>Start:</strong> ${startStr}</div>
              <div><strong>Ends:</strong> ${endStr} (${quiz.durationMinutes} mins)</div>
              <div><strong>Questions:</strong> ${quiz.questions ? quiz.questions.length : 0} MCQs</div>
            </div>
          </div>

          <!-- Quick Start Time Editor -->
          <div class="quick-time-row">
            <input type="datetime-local" id="quick-start-${id}" value="${inputVal}" />
            <button class="btn small secondary" onclick="updateStartTime('${id}')">Update Time</button>
          </div>

          <div class="quiz-card-actions">
            <button class="btn small success" onclick="startExamNow('${id}')">Start Now</button>
            <button class="btn small primary" onclick="setActiveExam('${id}')">Set Active</button>
            <button class="btn small secondary" onclick="loadExamForEdit('${id}')">Edit Exam</button>
            <button class="btn small secondary" onclick="openResultsTab('${id}')">Results</button>
            <button class="btn danger" onclick="deleteExam('${id}')">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

window.updateStartTime = async (id) => {
  const quiz = allQuizzes[id];
  const input = document.getElementById(`quick-start-${id}`);
  if (!quiz || !input || !input.value) return;

  const newStart = new Date(input.value).getTime();
  const newEnd = newStart + quiz.durationMinutes * 60 * 1000;

  await update(ref(db, `quizzes/${id}`), {
    startTime: newStart,
    endTime: newEnd
  });
  alert("Start time updated!");
};

window.startExamNow = async (id) => {
  const quiz = allQuizzes[id];
  if (!quiz) return;
  if (!confirm(`Start "${quiz.title}" immediately for all competitors?`)) return;

  const now = Date.now();
  const newEnd = now + quiz.durationMinutes * 60 * 1000;

  await update(ref(db, `quizzes/${id}`), {
    startTime: now,
    endTime: newEnd
  });
  await set(ref(db, "activeQuizId"), id);
  alert(`"${quiz.title}" is now LIVE!`);
};

window.setActiveExam = async (id) => {
  await set(ref(db, "activeQuizId"), id);
};

window.openResultsTab = (id) => {
  selectExamForResults(id);
  switchTab("tab-results");
};

window.deleteExam = async (id) => {
  if (!confirm("Delete this exam and all its submissions permanently?")) return;
  await remove(ref(db, `quizzes/${id}`));
  await remove(ref(db, `submissions/${id}`));
  if (activeQuizId === id) {
    await set(ref(db, "activeQuizId"), null);
  }
  if (editingQuizId === id) {
    resetExamBuilder();
  }
};

// Results Tab Logic
function populateResultsSelector() {
  const entries = Object.entries(allQuizzes).reverse();
  if (entries.length === 0) {
    resultsExamSelect.innerHTML = `<option value="">No exams available</option>`;
    return;
  }

  resultsExamSelect.innerHTML = entries
    .map(([id, quiz]) => `<option value="${id}">${escapeHTML(quiz.title)}</option>`)
    .join("");

  if (selectedQuizIdForResults && allQuizzes[selectedQuizIdForResults]) {
    resultsExamSelect.value = selectedQuizIdForResults;
  } else {
    const defaultId = activeQuizId && allQuizzes[activeQuizId] ? activeQuizId : entries[0][0];
    selectExamForResults(defaultId);
  }
}

resultsExamSelect.addEventListener("change", (e) => {
  if (e.target.value) {
    selectExamForResults(e.target.value);
  }
});

function selectExamForResults(quizId) {
  selectedQuizIdForResults = quizId;
  resultsExamSelect.value = quizId;
  const quiz = allQuizzes[quizId];
  resultsSubtitle.textContent = quiz
    ? `Showing results for: ${quiz.title}`
    : "Live competitor scores";

  onValue(ref(db, `submissions/${quizId}`), (snapshot) => {
    if (selectedQuizIdForResults !== quizId) return;
    const data = snapshot.val();
    if (!data) {
      currentResultsCache = [];
      resultsTbody.innerHTML = `<tr><td colspan="8" class="muted">No submissions yet for this exam.</td></tr>`;
      return;
    }

    const rows = Object.entries(data).map(([key, sub]) => ({
      pno: sub.pno || key,
      rank: sub.rank || "—",
      name: sub.name || "—",
      ship: sub.ship || "—",
      score: sub.score,
      total: sub.total,
      submittedAt: sub.submittedAt
    }));

    rows.sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
    currentResultsCache = rows;

    resultsTbody.innerHTML = rows
      .map((r, idx) => {
        const pct = ((r.score / r.total) * 100).toFixed(1);
        const timeStr = new Date(r.submittedAt).toLocaleTimeString();
        return `
          <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td><strong>${escapeHTML(r.pno)}</strong></td>
            <td>${escapeHTML(r.rank)}</td>
            <td>${escapeHTML(r.name)}</td>
            <td>${escapeHTML(r.ship)}</td>
            <td><strong>${r.score} / ${r.total}</strong></td>
            <td>${pct}%</td>
            <td>${timeStr}</td>
          </tr>
        `;
      })
      .join("");
  });
}

// Export CSV
document.getElementById("export-csv-btn").addEventListener("click", () => {
  if (currentResultsCache.length === 0) {
    alert("No results available to export.");
    return;
  }

  const headers = ["Position,P NO,Rank,Name,Ship,Score,Total,Percentage,Submitted At"];
  const lines = currentResultsCache.map((r, i) => {
    const pct = ((r.score / r.total) * 100).toFixed(1) + "%";
    const time = new Date(r.submittedAt).toLocaleString().replace(/,/g, "");
    return `${i + 1},"${r.pno}","${r.rank}","${r.name}","${r.ship}",${r.score},${r.total},${pct},"${time}"`;
  });

  const blob = new Blob([headers.concat(lines).join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ROR_Quiz_Results_${selectedQuizIdForResults}.csv`;
  a.click();
});

// Helpers
function toLocalDateTimeInput(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}