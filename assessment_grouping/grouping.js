const SUPABASE_URL = 'https://sjgcgesoxyjgknrcaldj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZ2NnZXNveHlqZ2tucmNhbGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMDYxODYsImV4cCI6MjA3ODU4MjE4Nn0.q_E-B_3xqMsXnQdQVjGOSUzINuMGwby7waPOg5nHdM0';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = {
    departmentId: null,
    departmentName: null,
    departmentYear: null,
    trainerId: null,
    trainerName: null,
    dayOrder: null,
    isCompleted: false,
    allStudents: [],
    groups: [],
    topics: [],
    currentGroupId: null,
    currentStudentForRemarks: null,
    deptGroupingId: null,
    editingGroupId: null  // NEW: Track which group is being edited
};

async function init() {
    try {
        const departmentId = sessionStorage.getItem('selectedDepartmentId');
        const departmentName = sessionStorage.getItem('selectedDepartment');
        const departmentYear = sessionStorage.getItem('selectedDepartmentYear');
        const trainerId = sessionStorage.getItem('trainerId');
        const trainerName = sessionStorage.getItem('trainerName');
        const dayOrder = sessionStorage.getItem('selectedDayOrder');

        if (!departmentId || !trainerId) {
            showError('Session data missing. Please select department again.');
            return;
        }

        state.departmentId = parseInt(departmentId);
        state.departmentName = departmentName;
        state.departmentYear = departmentYear;
        state.trainerId = trainerId;
        state.trainerName = trainerName;
        state.dayOrder = dayOrder;

        document.getElementById('pageTitle').textContent = 
            `Student Grouping: ${departmentName} - Day ${dayOrder}`;

        await loadTopics();
        await checkCompletionStatus();

        if (state.isCompleted) {
            await loadCompletedData();
            showView('completedView');
        } else {
            await loadStudents();
            
            // Try to load saved state from sessionStorage
            const hasRestoredState = loadStateFromSession();
            
            if (hasRestoredState) {
                console.log('Restored previous grouping state');
            }
            
            updateUI();
            showView('interactiveView');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize: ' + error.message);
    }
}

// Save current state to sessionStorage
function saveStateToSession() {
    sessionStorage.setItem('groupingState', JSON.stringify({
        groups: state.groups,
        allStudents: state.allStudents
    }));
}

// Load state from sessionStorage
function loadStateFromSession() {
    const savedState = sessionStorage.getItem('groupingState');
    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            state.groups = parsed.groups || [];
            state.allStudents = parsed.allStudents || [];
            return true;
        } catch (e) {
            console.error('Error loading saved state:', e);
            return false;
        }
    }
    return false;
}

// Clear grouping state from sessionStorage
function clearGroupingState() {
    sessionStorage.removeItem('groupingState');
}

async function loadTopics() {
    const { data, error } = await supabaseClient
        .from('ga_topics')
        .select('*')
        .order('id');

    if (error) throw error;

    state.topics = data || [];
    
    const select = document.getElementById('topicSelect');
    select.innerHTML = '<option value="">-- Select Topic --</option>';
    state.topics.forEach(topic => {
        const option = document.createElement('option');
        option.value = topic.id;
        option.textContent = topic.topics;
        select.appendChild(option);
    });
}

async function checkCompletionStatus() {
    const { data, error } = await supabaseClient
        .from('dept_grouping')
        .select('*')
        .eq('department_id', state.departmentId)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    state.isCompleted = !!data;
    if (data) {
        state.deptGroupingId = data.id;
    }
}

async function loadStudents() {
    const { data, error } = await supabaseClient
        .from('students')
        .select('*')
        .eq('department_id', state.departmentId)
        .eq('active', true)
        .order('roll_number');

    if (error) throw error;

    state.allStudents = (data || []).map(student => ({
        ...student,
        remarks: ''
    }));
}

async function loadCompletedData() {
    try {
        const { data: studentData, error: studError } = await supabaseClient
            .from('std_grouping')
            .select('*, students(*), ga_topics(*)')
            .eq('dept_grouping_id', state.deptGroupingId)
            .order('group_id', { ascending: true, nullsFirst: false });

        if (studError) throw studError;

        const { data: deptData, error: deptError } = await supabaseClient
            .from('dept_grouping')
            .select('*')
            .eq('id', state.deptGroupingId)
            .single();

        if (deptError) throw deptError;

        // Fetch trainer name from the view
        const { data: trainerData, error: trainerError } = await supabaseClient
            .from('trainer_names')
            .select('*')
            .eq('trainer_id', deptData.trainer_id)
            .single();

        if (trainerError) {
            console.warn('Could not fetch trainer data:', trainerError);
        }

        const infoDiv = document.getElementById('completedInfo');
        infoDiv.innerHTML = `
            <p><strong>Completed by:</strong> ${trainerData?.name || 'Unknown'}</p>
            <p><strong>Completed on:</strong> ${new Date(deptData.created_at).toLocaleString()}</p>
            <p><strong>Total Students:</strong> ${studentData.length}</p>
        `;

        const grouped = {};
        const unassigned = [];

        studentData.forEach(item => {
            if (item.group_id) {
                if (!grouped[item.group_id]) {
                    grouped[item.group_id] = {
                        students: [],
                        topic: item.ga_topics?.topics || 'Unknown Topic'
                    };
                }
                grouped[item.group_id].students.push({
                    ...item.students,
                    incharge: item.incharge
                });
            } else {
                unassigned.push({
                    ...item.students,
                    remarks: item.remarks
                });
            }
        });

        const groupsContainer = document.getElementById('completedGroupsContainer');
        groupsContainer.innerHTML = '<h2 class="section-title">Groups</h2><div class="groups-grid" id="completedGroupsGrid"></div>';
        if (window.lucide) {
            lucide.createIcons();
        }
        
        const groupsGrid = document.getElementById('completedGroupsGrid');

        if (Object.keys(grouped).length === 0) {
            groupsGrid.innerHTML = '<p class="empty-state">No groups created.</p>';
        } else {
            Object.keys(grouped).sort((a, b) => a - b).forEach(groupId => {
                const groupData = grouped[groupId];
                const inchargeStudent = groupData.students.find(s => s.incharge);

                const groupCard = document.createElement('div');
                groupCard.className = 'group-card readonly';

                const topicDisplay = groupData.topic !== 'No Topic' && groupData.topic !== 'Unknown Topic'
                    ? ` | <span class="group-topic-text"><strong>Topic:</strong> ${groupData.topic}</span>` 
                    : '';

                groupCard.innerHTML = `
                    <div class="group-card-header-new">
                        <div class="group-number-badge-inline">Group ${groupId}</div>
                    </div>
                    <div class="group-info-inline">
                        <span class="student-count">${groupData.students.length} student${groupData.students.length !== 1 ? 's' : ''}</span>${topicDisplay}
                    </div>
                    <div class="student-list-scrollable">
                        ${groupData.students.map((s, index) => {
                            const rollDisplay = index === 0 ? s.roll_number : s.roll_number.slice(-2);
                            return `
                                <div class="student-item-compact ${s.incharge ? 'incharge' : ''}">
                                    <span class="student-roll ${index === 0 ? '' : 'short'}">${rollDisplay} - ${s.name}</span>
                                    ${s.incharge ? '<span class="incharge-star">★</span>' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                    ${inchargeStudent ? `
                        <p style="margin-top: 15px; color: #636e72; font-size: 13px;">
                            <strong>Incharge:</strong> ${inchargeStudent.name}
                        </p>
                    ` : ''}
                `;
                groupsGrid.appendChild(groupCard);
            });
        }

        const unassignedContainer = document.getElementById('completedUnassignedContainer');
        if (unassigned.length > 0) {
            unassignedContainer.innerHTML = `
                <div class="unassigned-section">
                    <h2 class="section-title">Unassigned Students</h2>
                    ${unassigned.map(s => `
                        <div class="unassigned-student-completed">
                            <span class="student-info">${s.roll_number} - ${s.name}</span>
                            <span class="remarks-inline"><strong>Remarks:</strong> ${s.remarks || 'No remarks'}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            unassignedContainer.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading completed data:', error);
        showError('Failed to load completed data: ' + error.message);
    }
}

// NEW: Combined modal for create and edit
function openCreateGroupModal() {
    state.editingGroupId = null;
    
    document.getElementById('modalTitle').textContent = 'Create New Group';
    document.getElementById('saveGroupBtn').textContent = 'Save Group';
    document.getElementById('topicSelect').value = '';

    
    // Show/hide topic section based on department name
    const topicFormGroup = document.getElementById('topicFormGroup');
    if (state.departmentName && state.departmentName.substring(0, 2).toUpperCase() === 'II') {
        topicFormGroup.style.display = 'none';
    } else {
        topicFormGroup.style.display = 'block';
    }
    
    populateStudentCheckboxes();
    
    document.getElementById('createGroupModal').classList.add('active');
}

// NEW: Open modal for editing existing group
function openEditGroupModal(groupId) {
    state.editingGroupId = groupId;
    const group = state.groups.find(g => g.id === groupId);
    
    document.getElementById('modalTitle').textContent = 'Edit Group';
    document.getElementById('saveGroupBtn').textContent = 'Update Group';
    document.getElementById('topicSelect').value = group.topicId;
    
    // Show/hide topic section based on department name
    const topicFormGroup = document.getElementById('topicFormGroup');
    if (state.departmentName && state.departmentName.substring(0, 2).toUpperCase() === 'II') {
        topicFormGroup.style.display = 'none';
    } else {
        topicFormGroup.style.display = 'block';
    }
    
    populateStudentCheckboxes(groupId);
    
    document.getElementById('createGroupModal').classList.add('active');
}

// NEW: Populate student checkboxes
function populateStudentCheckboxes(editingGroupId = null) {
    const container = document.getElementById('studentCheckboxes');
    container.innerHTML = '';

    const assignedToOtherGroups = new Set();
    state.groups.forEach(g => {
        if (g.id !== editingGroupId) {
            g.students.forEach(s => assignedToOtherGroups.add(s.roll_number));
        }
    });

    const currentGroup = editingGroupId ? state.groups.find(g => g.id === editingGroupId) : null;
    const currentGroupStudents = currentGroup ? currentGroup.students.map(s => s.roll_number) : [];

    state.allStudents.forEach(student => {
        const isInCurrentGroup = currentGroupStudents.includes(student.roll_number);
        const isInOtherGroup = assignedToOtherGroups.has(student.roll_number);
        
        if (!isInOtherGroup || isInCurrentGroup) {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `
                <label>
                    <input type="checkbox" value="${student.roll_number}" ${isInCurrentGroup ? 'checked' : ''} onchange="updateStudentCount()">
                    ${student.roll_number} - ${student.name}
                </label>
            `;
            container.appendChild(div);
        }
    });

    if (container.children.length === 0) {
        container.innerHTML = '<p class="empty-state">No available students to add.</p>';
    }
    
    updateStudentCount();
    
    // ADD THIS LINE - Reset scroll to top
        setTimeout(() => {
            container.scrollTop = 0;
        }, 0);
}

function updateStudentCount() {
    const checkboxes = document.querySelectorAll('#studentCheckboxes input[type="checkbox"]:checked');
    const count = checkboxes.length;
    const counter = document.getElementById('studentCounter');
    const saveBtn = document.getElementById('saveGroupBtn');
    
    // Update counter text and color
    counter.textContent = `Selected: ${count}/8 students`;
    counter.className = 'student-counter';
    
    if (count < 3) {
        counter.classList.add('insufficient');
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
    } else if (count > 8) {
        counter.classList.add('exceeded');
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
    } else {
        counter.classList.add('valid');
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    }
}


// NEW: Update incharge dropdown based on selected students
//function updateInchargeDropdown() {
    //const checkboxes = document.querySelectorAll('#studentCheckboxes input[type="checkbox"]:checked');
    //const selectedRollNumbers = Array.from(checkboxes).map(cb => cb.value);
    
    //const inchargeSelect = document.getElementById('inchargeSelect');
    //const currentValue = inchargeSelect.value;
    
    //inchargeSelect.innerHTML = '<option value="">-- Select Incharge --</option>';
    
    //selectedRollNumbers.forEach(rollNumber => {
        //const student = state.allStudents.find(s => s.roll_number === rollNumber);
        //if (student) {
            //const option = document.createElement('option');
            //option.value = rollNumber;
            //option.textContent = `${rollNumber} - ${student.name}`;
            //if (rollNumber === currentValue) {
                //option.selected = true;
            //}
            //inchargeSelect.appendChild(option);
        //}
    //});
//}

// NEW: Combined save function for both create and edit
function saveGroup() {
    // Check if department starts with "II" - if so, skip topic validation
    const isDepartmentII = state.departmentName && state.departmentName.substring(0, 2).toUpperCase() === 'II';
    
    let topicId = null;
    let topicName = 'No Topic';
    
    if (!isDepartmentII) {
        topicId = document.getElementById('topicSelect').value;
        if (!topicId) {
            alert('Please select a topic');
            return;
        }
        const topic = state.topics.find(t => t.id == topicId);
        topicName = topic.topics;
    }

    const checkboxes = document.querySelectorAll('#studentCheckboxes input[type="checkbox"]:checked');
    const selectedRollNumbers = Array.from(checkboxes).map(cb => cb.value);

    if (selectedRollNumbers.length < 3 || selectedRollNumbers.length > 8) {
        alert('Please select between 3 and 8 students');
        return;
    }
    
    if (state.editingGroupId) {
        // Edit existing group - preserve existing incharge if students still include them
        const group = state.groups.find(g => g.id === state.editingGroupId);
        const oldIncharge = group.incharge;
        
        group.topicId = topicId ? parseInt(topicId) : null;
        group.topicName = topicName;
        group.students = selectedRollNumbers.map(rn => 
            state.allStudents.find(s => s.roll_number === rn)
        );
        
        // Keep old incharge if they're still in the group, otherwise reset
        if (oldIncharge && selectedRollNumbers.includes(oldIncharge)) {
            group.incharge = oldIncharge;
        } else {
            group.incharge = null;
        }
    } else {
        // Create new group without incharge (will be set via star button)
        const groupNumber = state.groups.length + 1;
        state.groups.push({
            id: `group_${Date.now()}`,
            number: groupNumber,
            name: `Group ${groupNumber}`,
            topicId: topicId ? parseInt(topicId) : null,
            topicName: topicName,
            students: selectedRollNumbers.map(rn => 
                state.allStudents.find(s => s.roll_number === rn)
            ),
            incharge: null
        });
    }

    closeModal('createGroupModal');
    updateUI();
}

function deleteGroup(groupId) {
    if (!confirm('Are you sure you want to delete this group?')) {
        return;
    }

    state.groups = state.groups.filter(g => g.id !== groupId);
    
    state.groups.forEach((group, index) => {
        group.number = index + 1;
        group.name = `Group ${index + 1}`;
    });
    
    updateUI();
}

function openRemarksModal(student) {
    state.currentStudentForRemarks = student;
    document.getElementById('remarkStudentInfo').textContent = 
        `${student.roll_number} - ${student.name}`;
    document.getElementById('remarksText').value = student.remarks || '';
    document.getElementById('remarksModal').classList.add('active');
}

function saveRemarks() {
    const remarks = document.getElementById('remarksText').value.trim();
    if (!remarks) {
        alert('Please enter remarks');
        return;
    }

    const student = state.allStudents.find(s => 
        s.roll_number === state.currentStudentForRemarks.roll_number
    );
    if (student) {
        student.remarks = remarks;
    }

    closeModal('remarksModal');
    updateUI();
    saveStateToSession(); // Explicitly save after adding remarks
}

function updateUI() {
    renderGroups();
    renderUnassignedStudents();
    updateProgress();
    
    // Save state to sessionStorage after every update
    saveStateToSession();
}

// NEW: Render groups as cards
function renderGroups() {
    const container = document.getElementById('groupsContainer');
    container.innerHTML = '';

        if (state.groups.length === 0) {
            container.innerHTML = `
        <div class="empty-state-illustrated">
            <h3>No Groups Yet</h3>
            <p>Get started by creating your first group!</p>
            <div class="empty-state-steps">
                <div class="empty-state-step">
                    <span class="step-number">1</span>
                    <span>Click "+ Create Group" button</span>
                </div>
                <div class="empty-state-step">
                    <span class="step-number">2</span>
                    <span>Select students & topic</span>
                </div>
                <div class="empty-state-step">
                    <span class="step-number">3</span>
                    <span>Assign incharge</span>
                </div>
            </div>
        </div>
    `;
        return;
    }

    state.groups.forEach(group => {
        const groupCard = document.createElement('div');
        groupCard.className = 'group-card';

        const studentsList = group.students.map((student, index) => {
            const isIncharge = group.incharge === student.roll_number;
            const rollDisplay = index === 0 ? student.roll_number : student.roll_number.slice(-2);
            
            return `
                <div class="student-item-compact ${isIncharge ? 'incharge' : ''}">
                    <span class="student-roll ${index === 0 ? '' : 'short'}">${rollDisplay} - ${student.name}</span>
                    <button class="star-btn ${isIncharge ? 'active' : ''}" 
                            onclick="setIncharge('${group.id}', '${student.roll_number}')"
                            title="${isIncharge ? 'Current Incharge' : 'Set as Incharge'}">
                        <i data-lucide="star" class="star-icon"></i>
                    </button>
                </div>
            `;
        }).join('');

        // Show topic only if not "No Topic"
        const topicDisplay = group.topicName !== 'No Topic' 
            ? ` | <span class="group-topic-text"><strong>Topic:</strong> ${group.topicName}</span>` 
            : '';

        
        const inchargeStudent = group.incharge ? group.students.find(s => s.roll_number === group.incharge) : null;

        groupCard.innerHTML = `
            <div class="group-card-header-new">
                <div class="group-number-badge-inline">Group ${group.number}</div>
                <div class="group-card-actions">
                    <button class="icon-btn edit" onclick="openEditGroupModal('${group.id}')" title="Edit Group">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="icon-btn delete" onclick="deleteGroup('${group.id}')" title="Delete Group">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="group-info-inline">
                <span class="student-count">${group.students.length} student${group.students.length !== 1 ? 's' : ''}</span>${topicDisplay}
            </div>
            <div class="student-list-scrollable">
                ${studentsList}
            </div>
            ${inchargeStudent ? `
                <p class="incharge-display" style="margin-top: 15px; padding-top: 12px; border-top: 2px solid var(--border); color: #000000ff; font-size: 0.9rem; font-weight: 600;">
                    Incharge: ${inchargeStudent.name}
                </p>
            ` : ''}
        `;

        container.appendChild(groupCard);
    });

    // Initialize Lucide icons after rendering
    if (window.lucide) {
        lucide.createIcons();
    }
}

// NEW FUNCTION: Set incharge for a group
function setIncharge(groupId, rollNumber) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;
    
    // Toggle: if clicking the current incharge, remove it; otherwise set new incharge
    if (group.incharge === rollNumber) {
        group.incharge = null;
    } else {
        group.incharge = rollNumber;
    }
    
    // UPDATE ONLY THE SPECIFIC GROUP CARD instead of full UI refresh
    updateSingleGroupCard(groupId);
    updateProgress();
    saveStateToSession();
}

function updateSingleGroupCard(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;
    
    // Find the group card in DOM
    const groupCards = document.querySelectorAll('.group-card');
    const groupIndex = state.groups.findIndex(g => g.id === groupId);
    const groupCard = groupCards[groupIndex];
    
    if (!groupCard) return;
    
    // Update only the students list and incharge display
    const studentListContainer = groupCard.querySelector('.student-list-scrollable');
    
    const studentsList = group.students.map((student, index) => {
        const isIncharge = group.incharge === student.roll_number;
        const rollDisplay = index === 0 ? student.roll_number : student.roll_number.slice(-2);
        
        return `
            <div class="student-item-compact ${isIncharge ? 'incharge' : ''}">
                <span class="student-roll ${index === 0 ? '' : 'short'}">${rollDisplay} - ${student.name}</span>
                <button class="star-btn ${isIncharge ? 'active' : ''}" 
                        onclick="setIncharge('${group.id}', '${student.roll_number}')"
                        title="${isIncharge ? 'Current Incharge' : 'Set as Incharge'}">
                    <i data-lucide="star" class="star-icon"></i>
                </button>
            </div>
        `;
    }).join('');
    
    studentListContainer.innerHTML = studentsList;
    
    // Update or add incharge display at bottom
    let inchargeDisplay = groupCard.querySelector('.incharge-display');
    
    if (group.incharge) {
        const inchargeStudent = group.students.find(s => s.roll_number === group.incharge);
        const inchargeHTML = `
            <p class="incharge-display" style="margin-top: 15px; padding-top: 12px; border-top: 2px solid var(--border); color: #000000ff; font-size: 0.9rem; font-weight: 600;">
                Incharge: ${inchargeStudent.name}
            </p>
        `;
        
        if (inchargeDisplay) {
            inchargeDisplay.outerHTML = inchargeHTML;
        } else {
            studentListContainer.insertAdjacentHTML('afterend', inchargeHTML);
        }
    } else {
        if (inchargeDisplay) {
            inchargeDisplay.remove();
        }
    }
    
    // Re-initialize Lucide icons for this card
    if (window.lucide) {
        lucide.createIcons();
    }
}

function renderUnassignedStudents() {
    const container = document.getElementById('unassignedStudents');
    container.innerHTML = '';

    const assignedStudentIds = new Set();
    state.groups.forEach(g => {
        g.students.forEach(s => assignedStudentIds.add(s.roll_number));
    });

    const unassignedStudents = state.allStudents.filter(s => 
        !assignedStudentIds.has(s.roll_number)
    );

    if (unassignedStudents.length === 0) {
        container.innerHTML = '<p class="empty-state">All students are assigned to groups!</p>';
        return;
    }

    unassignedStudents.forEach(student => {
        const div = document.createElement('div');
        const hasRemarks = student.remarks && student.remarks.trim() !== '';
        
        div.className = 'unassigned-student-inline';
        div.innerHTML = `
            <div class="student-info-inline">
                <span class="student-name">${student.roll_number} - ${student.name}</span>
                ${hasRemarks ? `<span class="remarks-text"><strong>Remarks:</strong> ${student.remarks}</span>` : ''}
                <div id="remarks-container-${student.roll_number}"></div>
            </div>
            <button class="btn btn-secondary btn-small" onclick="toggleInlineRemarks('${student.roll_number}')">
                ${hasRemarks ? 'Edit' : 'Add Remarks'}
            </button>
        `;
        
        container.appendChild(div);
    });
}

function updateProgress() {
    const totalStudents = state.allStudents.length;
    
    if (totalStudents === 0) {
        document.getElementById('progressInfo').innerHTML = 
            '<strong>No students in this department</strong>';
        document.getElementById('submitSection').style.display = 'none';
        return;
    }

    const assignedStudents = new Set();
    state.groups.forEach(g => {
        g.students.forEach(s => assignedStudents.add(s.roll_number));
    });

    const studentsWithRemarks = state.allStudents.filter(s => 
        !assignedStudents.has(s.roll_number) && s.remarks && s.remarks.trim() !== ''
    ).length;

    const completed = assignedStudents.size + studentsWithRemarks;
    const pending = totalStudents - completed;
    const percentage = Math.round((completed / totalStudents) * 100);

    const progressInfo = document.getElementById('progressInfo');
    progressInfo.innerHTML = `
        <div class="progress-stats">
            <div class="progress-number">${percentage}%</div>
            <div class="progress-label">Complete</div>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${percentage}%"></div>
        </div>
        <div class="progress-details">
            <div class="progress-item">
                <span class="progress-icon">✓</span>
                <span>${assignedStudents.size} Assigned</span>
            </div>
            <div class="progress-item">
                <span class="progress-icon">📝</span>
                <span>${studentsWithRemarks} With Remarks</span>
            </div>
            <div class="progress-item">
                <span class="progress-icon">${pending === 0 ? '🎉' : '⏳'}</span>
                <span>${pending} Pending</span>
            </div>
        </div>
    `;

    const submitSection = document.getElementById('submitSection');
    
    if (pending === 0 && state.groups.length > 0) {
        const allGroupsHaveIncharge = state.groups.every(g => g.incharge !== null);
        submitSection.style.display = allGroupsHaveIncharge ? 'block' : 'none';
    } else {
        submitSection.style.display = 'none';
    }
}

function saveInlineRemarks(rollNumber) {
    const textarea = document.getElementById(`remarks-${rollNumber}`);
    const remarks = textarea.value.trim();
    
    if (!remarks) {
        alert('Please enter remarks');
        return;
    }
    
    const student = state.allStudents.find(s => s.roll_number === rollNumber);
    if (student) {
        student.remarks = remarks;
    }
    
    updateUI();
}

function toggleInlineRemarks(rollNumber) {
    const student = state.allStudents.find(s => s.roll_number === rollNumber);
    if (!student) return;
    
    const container = document.getElementById(`remarks-container-${rollNumber}`);
    container.innerHTML = `
        <textarea id="remarks-${rollNumber}" 
                  placeholder="Enter remarks for this student..." 
                  style="width: 100%; padding: 10px; border: 2px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 0.85rem; margin-top: 10px; min-height: 80px; resize: vertical;">${student.remarks || ''}</textarea>
        <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button class="btn btn-primary btn-small" onclick="saveInlineRemarks('${rollNumber}')">Save</button>
            <button class="btn btn-secondary btn-small" onclick="updateUI()">Cancel</button>
        </div>
    `;
}

async function submitData() {
    if (!confirm('Are you sure you want to submit? This action cannot be undone.')) {
        return;
    }

    try {
        showView('loadingView');

        const { data: deptGrouping, error: deptError } = await supabaseClient
            .from('dept_grouping')
            .insert({
                department_id: state.departmentId,
                trainer_id: state.trainerId
            })
            .select()
            .single();

        if (deptError) {
            throw new Error('Failed to create department grouping: ' + deptError.message);
        }

        const deptGroupingId = deptGrouping.id;
        const stdGroupingRecords = [];

        state.groups.forEach(group => {
            group.students.forEach(student => {
                stdGroupingRecords.push({
                    roll_number: student.roll_number,
                    group_id: group.number,
                    topic_id: group.topicId,
                    incharge: group.incharge === student.roll_number,
                    dept_grouping_id: deptGroupingId,
                    remarks: null
                });
            });
        });

        const assignedStudentIds = new Set();
        state.groups.forEach(g => {
            g.students.forEach(s => assignedStudentIds.add(s.roll_number));
        });

        state.allStudents.forEach(student => {
            if (!assignedStudentIds.has(student.roll_number)) {
                stdGroupingRecords.push({
                    roll_number: student.roll_number,
                    group_id: null,
                    topic_id: null,
                    incharge: false,
                    dept_grouping_id: deptGroupingId,
                    remarks: student.remarks || null
                });
            }
        });

        if (stdGroupingRecords.length > 0) {
            const { error: stdError } = await supabaseClient
                .from('std_grouping')
                .insert(stdGroupingRecords);

            if (stdError) {
                await supabaseClient
                    .from('dept_grouping')
                    .delete()
                    .eq('id', deptGroupingId);
                
                throw new Error('Failed to save student groupings: ' + stdError.message);
            }
        }

        alert('✓ Data submitted successfully!');

        // Clear saved state since data is now submitted
        clearGroupingState();

        state.isCompleted = true;
        state.deptGroupingId = deptGroupingId;
        await loadCompletedData();
        showView('completedView');

    } catch (error) {
        console.error('Submission error:', error);
        showError('Submission failed: ' + error.message);
        showView('interactiveView');
    }
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    showView('errorView');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function goBack() {
    // Check if we're in the interactive view (editing mode)
    const interactiveView = document.getElementById('interactiveView');
    const isEditing = interactiveView && interactiveView.classList.contains('active');
    
    // Check if there are any groups or remarks
    const hasUnsavedWork = state.groups.length > 0 || 
                          state.allStudents.some(s => s.remarks && s.remarks.trim() !== '');
    
    // Show confirmation if editing and has unsaved work
    if (isEditing && hasUnsavedWork) {
        if (!confirm('Are you sure you want to go back? Any unsaved changes will be lost.')) {
            return; // User clicked Cancel, don't navigate
        }
    }
    
    // Clear grouping state when going back to selection
    clearGroupingState();
    window.location.href = '../selection.html';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

window.onload = init;


