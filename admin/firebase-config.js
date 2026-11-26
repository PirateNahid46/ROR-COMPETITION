 import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

    const firebaseConfig = {
    apiKey: "AIzaSyDNKmBmdZ25SQlQ3A2rVzzs5tK9yEy2uz8",
    authDomain: "ror-quiz-4323.firebaseapp.com",
    databaseURL: "https://ror-quiz-4323-default-rtdb.firebaseio.com",
    projectId: "ror-quiz-4323",
    storageBucket: "ror-quiz-4323.firebasestorage.app",
    messagingSenderId: "752305599181",
    appId: "1:752305599181:web:3838698f9f05b04d372f84"

  };

    const app = initializeApp(firebaseConfig);
    window.rorFirebase = {
      app,
      auth: getAuth(app),
      db: getDatabase(app)
    };