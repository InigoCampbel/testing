// ========================================
// SUPABASE CONFIGURATION
// ========================================
const SUPABASE_URL = 'https://sjgcgesoxyjgknrcaldj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZ2NnZXNveHlqZ2tucmNhbGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMDYxODYsImV4cCI6MjA3ODU4MjE4Nn0.q_E-B_3xqMsXnQdQVjGOSUzINuMGwby7waPOg5nHdM0';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========================================
// STATE MANAGEMENT
// ========================================
const state = {
    students: [],
    assessments: [],
    filteredStudents: [],
    currentFilter: 'all',
    selectedStudent: null,
    scores: {
        communication: null,
        creativity: null,
        body_lang: null,
        confidence: null
    },
    minScore: 2,
    sessionData: {
        dayOrder: null,
        department: null,
        departmentId: null,
        trainerId: null,
        trainerName: null,
        trainerVendor: null
    }
};

// ========================================
// DOM ELEMENTS
// ========================================
const elements = {
    backBtn: document.getElementById('backBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    departmentDisplay: document.getElementById('departmentDisplay'),
    trainerName: document.getElementById('trainerName'),
    searchInput: document.getElementById('searchInput'),
    loadingDiv: document.getElementById('loadingDiv'),
    studentsGrid: document.getElementById('studentsGrid'),
    emptyState: document.getElementById('emptyState'),
    totalCount: document.getElementById('totalCount'),
    completedCount: document.getElementById('completedCount'),
    pendingCount: document.getElementById('pendingCount'),
    absentCount: document.getElementById('absentCount'),
    evaluationModal: document.getElementById('evaluationModal'),
    closeModal: document.getElementById('closeModal'),
    modalStudentName: document.getElementById('modalStudentName'),
    modalStudentRoll: document.getElementById('modalStudentRoll'),
    scoresTab: document.getElementById('scoresTab'),
    absentTab: document.getElementById('absentTab'),
    scoresForm: document.getElementById('scoresForm'),
    absentForm: document.getElementById('absentForm'),
    remarksInput: document.getElementById('remarksInput'),
    successMessage: document.getElementById('successMessage'),
    errorMessage: document.getElementById('errorMessage'),
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

function showMessage(message, type = 'success') {
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Remove after 4 seconds
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

function showLoading(show) {
    elements.loadingDiv.style.display = show ? 'block' : 'none';
    elements.studentsGrid.style.display = show ? 'none' : 'grid';
}

function getSessionData() {
    state.sessionData = {
        dayOrder: sessionStorage.getItem('selectedDayOrder'),
        department: sessionStorage.getItem('selectedDepartment'),
        departmentId: sessionStorage.getItem('selectedDepartmentId'),
        trainerId: sessionStorage.getItem('trainerId'),
        trainerName: sessionStorage.getItem('trainerName'),
        trainerVendor: sessionStorage.getItem('trainerVendor')
    };

    // Validate session data
    if (!state.sessionData.departmentId || !state.sessionData.trainerId) {
        showMessage('Session expired. Please select department again.', 'error');
        setTimeout(() => {
            window.location.href = '../selection.html';
        }, 2000);
        return false;
    }

    // Update UI with session data
    elements.departmentDisplay.textContent = state.sessionData.department || '-';
    elements.trainerName.textContent = state.sessionData.trainerName || '-';

    return true;
}

// ========================================
// DATA LOADING
// ========================================

async function loadStudents() {
    try {
        console.log('Loading students for department:', state.sessionData.departmentId);

        const { data, error } = await supabaseClient
            .from('students')
            .select('*')
            .eq('department_id', state.sessionData.departmentId)
            .eq('active', true)
            .order('roll_number');

        if (error) throw error;

        state.students = data || [];
        console.log('Loaded students:', state.students.length);

        return state.students;
    } catch (error) {
        console.error('Error loading students:', error);
        throw error;
    }
}

async function loadAssessments() {
    try {
        console.log('Loading assessments...');

        const { data, error } = await supabaseClient
            .from('extempore_assessments')
            .select('*');

        if (error) throw error;

        state.assessments = data || [];
        console.log('Loaded assessments:', state.assessments.length);

        return state.assessments;
    } catch (error) {
        console.error('Error loading assessments:', error);
        throw error;
    }
}

function getStudentAssessment(rollNumber) {
    return state.assessments.find(a => a.roll_number === rollNumber);
}

function getStudentStatus(student) {
    const assessment = getStudentAssessment(student.roll_number);
    
    if (!assessment) return 'pending';
    
    if (assessment.remarks && !assessment.communication) return 'absent';
    
    if (assessment.communication) return 'completed';
    
    return 'pending';
}

// ========================================
// STATISTICS
// ========================================

function updateStats() {
    const total = state.students.length;
    let completed = 0;
    let pending = 0;
    let absent = 0;

    state.students.forEach(student => {
        const status = getStudentStatus(student);
        if (status === 'completed') completed++;
        else if (status === 'absent') absent++;
        else pending++;
    });

    elements.totalCount.textContent = total;
    elements.completedCount.textContent = completed;
    elements.pendingCount.textContent = pending;
    elements.absentCount.textContent = absent;
}

// ========================================
// RENDERING
// ========================================

function renderStudents() {
    elements.studentsGrid.innerHTML = '';
    
    if (state.filteredStudents.length === 0) {
        elements.studentsGrid.style.display = 'none';
        elements.emptyState.style.display = 'block';
        return;
    }

    elements.studentsGrid.style.display = 'grid';
    elements.emptyState.style.display = 'none';

    state.filteredStudents.forEach(student => {
        const assessment = getStudentAssessment(student.roll_number);
        const status = getStudentStatus(student);

        const card = document.createElement('div');
        card.className = `student-card ${status}`;
        card.onclick = () => openEvaluationModal(student, assessment);

        let statusBadgeText = 'Yet to Evaluate';
        if (status === 'completed') statusBadgeText = 'Completed';
        else if (status === 'absent') statusBadgeText = 'Not Completed';

        let contentHTML = `
            <div class="student-header">
                <div class="student-info">
                    <h3>${student.name}</h3>
                    <div class="roll-number">${student.roll_number}</div>
                </div>
                <div class="status-badge ${status}">${statusBadgeText}</div>
            </div>
        `;

        if (assessment && assessment.communication) {
                const total = assessment.communication + assessment.creativity + assessment.body_lang + assessment.confidence;
                contentHTML += `
                    <div class="total-score">
                        <span class="total-label">Total Score:</span>
                        <span class="total-value">${total}/40</span>
                    </div>
                    <div class="scores-display">
                    <div class="score-item">
                        <div class="label">Communication</div>
                        <div class="value">${assessment.communication}/10</div>
                    </div>
                    <div class="score-item">
                        <div class="label">Creativity</div>
                        <div class="value">${assessment.creativity}/10</div>
                    </div>
                    <div class="score-item">
                        <div class="label">Body Language</div>
                        <div class="value">${assessment.body_lang}/10</div>
                    </div>
                    <div class="score-item">
                        <div class="label">Confidence</div>
                        <div class="value">${assessment.confidence}/10</div>
                    </div>
                </div>
            `;
        } else if (assessment && assessment.remarks) {
            contentHTML += `
                <div class="remarks-display">
                    ${assessment.remarks}
                </div>
            `;
        }

        card.innerHTML = contentHTML;
        elements.studentsGrid.appendChild(card);
    });

    updateStats();
}

function applyFilters() {
    const searchTerm = elements.searchInput.value.toLowerCase().trim();

    state.filteredStudents = state.students.filter(student => {
        // Search filter
        const matchesSearch = !searchTerm || 
            student.name.toLowerCase().includes(searchTerm) ||
            student.roll_number.toLowerCase().includes(searchTerm);

        // Status filter
        const status = getStudentStatus(student);
        const matchesFilter = state.currentFilter === 'all' || status === state.currentFilter;

        return matchesSearch && matchesFilter;
    });

    renderStudents();
}

// ========================================
// MODAL MANAGEMENT
// ========================================

function openEvaluationModal(student, assessment) {
    state.selectedStudent = student;

    elements.modalStudentName.textContent = student.name;
    elements.modalStudentRoll.textContent = `Roll Number: ${student.roll_number}`;

    // Check if assessment is completed (has scores and no remarks)
    const isCompleted = assessment && assessment.communication && !assessment.remarks;
    
    // Check if trainer is admin
    const isAdmin = state.sessionData.trainerVendor === 'admin';

    // If completed and not admin, don't open modal and show toast
    if (isCompleted && !isAdmin) {
        showMessage('This assessment is completed. Only admin can edit.', 'error');
        return;
    }

    // If has remarks (absent), switch to absent tab
    if (assessment && assessment.remarks && !assessment.communication) {
        switchTab('absent');
        elements.remarksInput.value = assessment.remarks;
    } else if (assessment && assessment.communication) {
            // If has scores, populate them
            switchTab('scores');
            setScore('communication', assessment.communication);
            setScore('creativity', assessment.creativity);
            setScore('body_lang', assessment.body_lang);
            setScore('confidence', assessment.confidence);
        } else {
        // New assessment
        switchTab('scores');
        resetScoreSliders();
        updateTotalScoreDisplay();
        elements.remarksInput.value = '';
    }

    elements.evaluationModal.classList.add('active');
}

function closeEvaluationModal() {
    elements.evaluationModal.classList.remove('active');
    state.selectedStudent = null;
    elements.scoresForm.reset();
    elements.absentForm.reset();
    resetScoreSliders();
    updateTotalScoreDisplay();
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Update tab content
    elements.scoresTab.classList.remove('active');
    elements.absentTab.classList.remove('active');

    if (tabName === 'scores') {
        elements.scoresTab.classList.add('active');
    } else {
        elements.absentTab.classList.add('active');
    }
}

function resetScoreSliders() {
    state.scores = {
        communication: null,
        creativity: null,
        body_lang: null,
        confidence: null
    };
    document.querySelectorAll('.score-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
}

function setScore(type, value) {
    state.scores[type] = value;
    const container = document.querySelector(`[data-score-type="${type}"]`);
    if (container) {
        container.querySelectorAll('.score-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (parseInt(btn.dataset.value) === value) {
                btn.classList.add('selected');
            }
        });
    }
    
    // Update total score display
    updateTotalScoreDisplay();
}

function updateTotalScoreDisplay() {
    const totalDisplay = document.getElementById('totalScoreDisplay');
    if (!totalDisplay) return;
    
    const total = (state.scores.communication || 0) + 
                  (state.scores.creativity || 0) + 
                  (state.scores.body_lang || 0) + 
                  (state.scores.confidence || 0);
    
    totalDisplay.textContent = `${total}/40`;
}



function validateScores() {
    const errors = [];
    
    if (!state.scores.communication) errors.push('Communication');
    if (!state.scores.creativity) errors.push('Creativity');
    if (!state.scores.body_lang) errors.push('Body Language');
    if (!state.scores.confidence) errors.push('Confidence');
    
    if (errors.length > 0) {
        showMessage(`Please select scores for: ${errors.join(', ')}`, 'error');
        return false;
    }
    
    // Check minimum scores per category
    const minErrors = [];
    if (state.scores.communication < state.minScore) minErrors.push('Communication');
    if (state.scores.creativity < state.minScore) minErrors.push('Creativity');
    if (state.scores.body_lang < state.minScore) minErrors.push('Body Language');
    if (state.scores.confidence < state.minScore) minErrors.push('Confidence');
    
    if (minErrors.length > 0) {
        showMessage(`Minimum score is ${state.minScore} for: ${minErrors.join(', ')}`, 'error');
        return false;
    }
    
    // Check minimum total score
    const totalScore = state.scores.communication + state.scores.creativity + 
                      state.scores.body_lang + state.scores.confidence;
    const minTotalScore = 20; // Set your desired minimum total here
    
    if (totalScore < minTotalScore) {
        showMessage(`Total score must be at least ${minTotalScore}.`, 'error');
        return false;
    }
    
    return true;
}

// ========================================
// FORM SUBMISSION
// ========================================

async function submitScores(event) {
    event.preventDefault();

    if (!state.selectedStudent) return;

    // Validate scores
    if (!validateScores()) return;

    const scores = {
        roll_number: state.selectedStudent.roll_number,
        communication: state.scores.communication,
        creativity: state.scores.creativity,
        body_lang: state.scores.body_lang,
        confidence: state.scores.confidence,
        trainer_id: state.sessionData.trainerId,
        remarks: null // Will be auto-cleared by trigger
    };

    try {
        console.log('Submitting scores:', scores);

        // Check if assessment already exists
        const existingAssessment = getStudentAssessment(state.selectedStudent.roll_number);

        let result;
        if (existingAssessment) {
            // Update existing
            const { data, error } = await supabaseClient
                .from('extempore_assessments')
                .update(scores)
                .eq('roll_number', state.selectedStudent.roll_number)
                .select();

            if (error) throw error;
            result = data;
        } else {
            // Insert new
            const { data, error } = await supabaseClient
                .from('extempore_assessments')
                .insert([scores])
                .select();

            if (error) throw error;
            result = data;
        }

        console.log('Assessment saved:', result);

        // Reload assessments and update UI
        await loadAssessments();
        applyFilters();

        showMessage('Assessment saved successfully!', 'success');
        closeEvaluationModal();

    } catch (error) {
        console.error('Error saving assessment:', error);
        showMessage('Error saving assessment: ' + error.message, 'error');
    }
}

async function submitAbsent(event) {
    event.preventDefault();

    if (!state.selectedStudent) return;

    const remarks = elements.remarksInput.value.trim();

    if (!remarks) {
        showMessage('Please enter remarks', 'error');
        return;
    }

    const absentData = {
        roll_number: state.selectedStudent.roll_number,
        remarks: remarks,
        trainer_id: state.sessionData.trainerId,
        communication: null,
        creativity: null,
        body_lang: null,
        confidence: null
    };

    try {
        console.log('Marking as absent:', absentData);

        // Check if assessment already exists
        const existingAssessment = getStudentAssessment(state.selectedStudent.roll_number);

        let result;
        if (existingAssessment) {
            // Update existing
            const { data, error } = await supabaseClient
                .from('extempore_assessments')
                .update(absentData)
                .eq('roll_number', state.selectedStudent.roll_number)
                .select();

            if (error) throw error;
            result = data;
        } else {
            // Insert new
            const { data, error } = await supabaseClient
                .from('extempore_assessments')
                .insert([absentData])
                .select();

            if (error) throw error;
            result = data;
        }

        console.log('Absence marked:', result);

        // Reload assessments and update UI
        await loadAssessments();
        applyFilters();

        showMessage('Student marked as absent', 'success');
        closeEvaluationModal();

    } catch (error) {
        console.error('Error marking absent:', error);
        showMessage('Error marking absent: ' + error.message, 'error');
    }
}

// ========================================
// EVENT LISTENERS
// ========================================

// Navigation
elements.backBtn.addEventListener('click', () => {
    window.location.href = '../department_selection.html';
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await supabaseClient.auth.signOut();
        window.location.href = '../index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Search and Filter
elements.searchInput.addEventListener('input', applyFilters);

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentFilter = btn.dataset.filter;
        applyFilters();
    });
});

// Modal
elements.closeModal.addEventListener('click', closeEvaluationModal);
elements.evaluationModal.addEventListener('click', (e) => {
    if (e.target === elements.evaluationModal) {
        closeEvaluationModal();
    }
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

// Score Buttons
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('score-btn')) {
        const type = e.target.closest('.score-buttons').dataset.scoreType;
        const value = parseInt(e.target.dataset.value);
        setScore(type, value);
    }
});

// Forms
elements.scoresForm.addEventListener('submit', submitScores);
elements.absentForm.addEventListener('submit', submitAbsent);

document.getElementById('cancelScoresBtn').addEventListener('click', closeEvaluationModal);
document.getElementById('cancelAbsentBtn').addEventListener('click', closeEvaluationModal);

// ========================================
// INITIALIZATION
// ========================================

async function initialize() {
    try {
        showLoading(true);

        // Get session data
        if (!getSessionData()) return;

        // Check authentication
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error || !session) {
            showMessage('Please login first', 'error');
            setTimeout(() => {
                window.location.href = '../index.html';
            }, 2000);
            return;
        }

        // Load data
        await Promise.all([
            loadStudents(),
            loadAssessments()
        ]);

        // Initial render
        state.filteredStudents = [...state.students];
        renderStudents();
        showLoading(false);

    } catch (error) {
        console.error('Initialization error:', error);
        showMessage('Error loading data: ' + error.message, 'error');
        showLoading(false);
    }
}

// Start the app
initialize();