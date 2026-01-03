// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://sjgcgesoxyjgknrcaldj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZ2NnZXNveHlqZ2tucmNhbGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMDYxODYsImV4cCI6MjA3ODU4MjE4Nn0.q_E-B_3xqMsXnQdQVjGOSUzINuMGwby7waPOg5nHdM0';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// GLOBAL STATE
// ==========================================
let currentTable = 'attendance';
let editingRecord = null;
let allData = {};
let filteredData = {};
let multiSelectState = {};

// Pagination state
let currentPage = {};
let pageSize = 50;
let totalRecords = {};
let dataLoaded = {}; // Track which tables have loaded data

// Reference data
let departments = [];
let sessions = [];
let topics = [];
let trainers = [];
let students = [];

// Maps for quick lookup
let departmentMap = {};
let sessionMap = {};
let topicMap = {};
let trainerMap = {};
let studentMap = {};

// ==========================================
// INITIALIZATION
// ==========================================
async function init() {
    await checkAuth();
    await loadReferenceData();
    
    // Try to restore previous state (filters only, not data)
    loadState();
    
    // Initialize multiselects AFTER loading state
    initializeMultiselects();
    
    // Restore multiselect checkboxes from saved state
    setTimeout(() => {
        Object.keys(multiSelectState).forEach(id => {
            const selected = multiSelectState[id] || [];
            selected.forEach(option => {
                const checkbox = document.getElementById(`${id}-${option}`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
            updateMultiselectDisplay(id);
        });
        
        // Check if filters are active for current table
        const hasFilters = checkIfFiltersActive(currentTable);
        
        if (hasFilters) {
            // Auto-apply filters if they exist
            applyFilters(currentTable);
        } else {
            // Show default message
            switchTab(currentTable);
            showFilterMessage(currentTable);
        }
    }, 300);
    
    setupEventListeners();
}

function showFilterMessage(table) {
    const tableEl = document.getElementById(table + '-table');
    
    // Don't show filter message for tables without filters
    if (table === 'sessions') {
        tableEl.innerHTML = '<tbody><tr><td colspan="10" class="loading">Loading data...</td></tr></tbody>';
        return;
    }
    
    tableEl.innerHTML = `
        <tbody>
            <tr>
                <td colspan="10" class="text-center filter-message">
                    <div class="filter-prompt">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke-width="2"/>
                        </svg>
                        <h3>Ready to View Data</h3>
                        <p>Select your filters above and click "Apply Filters" to load data</p>
                    </div>
                </td>
            </tr>
        </tbody>
    `;
}


// Check authorization
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || session.user.email !== 'cdc@psgcas.ac.in') {
        window.location.href = '../index.html';
    }
}

// Logout function
async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = '../index.html';
}


// Load all reference data
async function loadReferenceData() {
    try {
        // Load departments
        const { data: deptData } = await supabaseClient.from('departments').select('*').order('id', { ascending: true });
        departments = deptData || [];
        departments.forEach(d => departmentMap[d.id] = d);

        // Load sessions
        const { data: sessData } = await supabaseClient.from('sessions').select('*').order('id', { ascending: true });
        sessions = sessData || [];
        sessions.forEach(s => sessionMap[s.id] = s);

        // Load topics
        const { data: topicData } = await supabaseClient.from('topics').select('*').order('id', { ascending: true });
        topics = topicData || [];
        topics.forEach(t => topicMap[t.id] = t);

        // Load trainers
        const { data: trainerData } = await supabaseClient.from('trainers').select('*').order('trainer_id', { ascending: true });
        trainers = trainerData || [];
        trainers.forEach(t => trainerMap[t.trainer_id] = t);

        // Load students
        const { data: studentData } = await supabaseClient.from('students').select('*').order('roll_number', { ascending: true });
        students = studentData || [];
        students.forEach(s => studentMap[s.roll_number] = s);

        // Load day_order data for filters
        const { data: dayOrderData } = await supabaseClient.from('day_order').select('*');
        if (!allData['day_order']) allData['day_order'] = [];
        allData['day_order'] = dayOrderData || [];
        
        // REMOVED: initializeMultiselects() - this was causing the problem!
        
    } catch (error) {
        console.error('Error loading reference data:', error);
    }
}

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(table, event) {
    currentTable = table;
    
    // Update active tab button
    document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
    
    // Find and activate the correct tab button
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // When called programmatically (like from init), find the button by table name
        const tabButtons = document.querySelectorAll('.nav-tabs button');
        tabButtons.forEach(btn => {
            if (btn.textContent.toLowerCase().replace(/\s+/g, '_') === table.toLowerCase() ||
                btn.getAttribute('onclick')?.includes(`'${table}'`)) {
                btn.classList.add('active');
            }
        });
    }
    
    // Update active content section
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById(table).classList.add('active');
    
    // Check if data is already loaded for this table
    if (dataLoaded[table]) {
        // Calculate pagination for current page
        const from = ((currentPage[table] || 1) - 1) * pageSize;
        const to = from + pageSize;
        const paginatedData = (filteredData[table] || []).slice(from, to);
        
        renderTable(table, paginatedData);
        renderPagination(table);
    } else {
        // For tables without filters (sessions), auto-load data
        if (table === 'sessions') {
            loadData(table);
        } else {
            // Clear filters UI if no data is loaded
            clearFiltersForTable(table);
            showFilterMessage(table);
        }
    }
    
    // Save state after switching tabs
    saveState();
}


function checkIfFiltersActive(table) {
    // Check text inputs
    const textInputs = document.querySelectorAll(`#${table} input[type="text"], #${table} input[type="date"]`);
    for (let input of textInputs) {
        if (input.value) return true;
    }
    
    // Check selects
    const selects = document.querySelectorAll(`#${table} select`);
    for (let select of selects) {
        if (select.value) return true;
    }
    
    // Check multiselects
    for (let key in multiSelectState) {
        if (key.startsWith(table.substring(0, 4)) && multiSelectState[key].length > 0) {
            return true;
        }
    }
    
    return false;
}


// ==========================================
// DATA LOADING
// ==========================================
async function loadData(table, page = 1) {
    try {
        // Show loading
        const tableEl = document.getElementById(table + '-table');
        tableEl.innerHTML = '<tbody><tr><td colspan="10" class="loading">Loading data...</td></tr></tbody>';
        
        // Initialize page if needed
        if (!currentPage[table]) currentPage[table] = 1;
        currentPage[table] = page;
        
        let data;
        let count = 0;
        
        // Calculate range for pagination
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        
        if (table === 'attendance') {
            const result = await loadAttendanceData(from, to);
            data = result.data;
            count = result.count;
        } else if (table === 'attendance_sessions') {
            const result = await loadAttendanceSessionsData(from, to);
            data = result.data;
            count = result.count;
        } else if (table === 'students') {
            data = await loadStudentsData();  // ← Returns array directly
            count = data.length;  // ← This is correct
        } else if (table === 'day_order') {
            const result = await loadDayOrderData(from, to);
            data = result.data;
            count = result.count;
        } else {
            const result = await loadOtherTableData(table, from, to);
            data = result.data;
            count = result.count;
        }
        
        allData[table] = data;
        filteredData[table] = data;
        totalRecords[table] = count;
        dataLoaded[table] = true;
        
        renderTable(table, data);
        renderPagination(table);
        
    } catch (error) {
        showMessage(table, 'Error loading data: ' + error.message, 'error');
    }
}

// Load attendance with joined data
async function loadAttendanceData(from, to) {
    // First get total count
    const { count } = await supabaseClient
        .from('attendance')
        .select('*', { count: 'exact', head: true });
    
    // Then get paginated data WITH STUDENTS JOIN
    const { data: attendanceRecords, error } = await supabaseClient
        .from('attendance')
        .select(`
            *,
            attendance_sessions (
                date,
                session_id,
                department_id
            ),
            students (
                name,
                department_id
            )
        `)
        .order('id', { ascending: true })
        .range(from, to);
    
    if (error) throw error;
    
    // Enrich with joined data
    const enrichedData = attendanceRecords.map(record => {
        // Get student info from the JOIN (not from studentMap)
        const student = record.students || {};
        const dept = student.department_id ? departmentMap[student.department_id] : {};
        const session = record.attendance_sessions?.session_id ? sessionMap[record.attendance_sessions.session_id] : {};
        
        return {
            ...record,
            student_name: student.name || 'Unknown',
            department_name: dept.name || 'Unknown',
            date: record.attendance_sessions?.date || '',
            session_name: session.session || 'Unknown'
        };
    });
    
    return { data: enrichedData, count };
}

// Load attendance sessions with joined data
async function loadAttendanceSessionsData(from, to) {
    // Get total count
    const { count } = await supabaseClient
        .from('attendance_sessions')
        .select('*', { count: 'exact', head: true });
    
    // Get paginated data
    const { data, error } = await supabaseClient
        .from('attendance_sessions')
        .select('*')
        .order('id', { ascending: true })
        .range(from, to);
    
    if (error) throw error;
    
    const enrichedData = data.map(record => {
        const dept = record.department_id ? departmentMap[record.department_id] : {};
        const trainer = trainerMap[record.trainer_id] || {};
        const topic = record.topic_id ? topicMap[record.topic_id] : {};
        const session = sessionMap[record.session_id] || {};
        
        return {
            ...record,
            department_name: dept.name || '',
            trainer_name: trainer.name || '',
            vendor: record.vendor || trainer.vendor || '',  // ← CHANGED: Use record.vendor first, then fallback
            topic_name: topic.topic_name || '',
            session_name: session.session || '',
            duration: record.duration || '2.00' 
        };
    });
    
    return { data: enrichedData, count };
}


// Load students with department names - LOAD ALL DATA IN BATCHES
async function loadStudentsData() {
    const batchSize = 1000; // Supabase's safe batch size
    let allStudents = [];
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
        const { data, error } = await supabaseClient
            .from('students')
            .select('*')
            .order('roll_number', { ascending: true })
            .range(offset, offset + batchSize - 1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            allStudents = allStudents.concat(data);
            offset += batchSize;
            
            // If we got fewer records than batch size, we've reached the end
            if (data.length < batchSize) {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    }
    
    // Now enrich all students with department names
    const enrichedData = allStudents.map(student => {
        const dept = student.department_id ? departmentMap[student.department_id] : {};
        return {
            ...student,
            department_name: dept.name || ''
        };
    });
    
    return enrichedData;
}



// Load day_order with department names
async function loadDayOrderData(from, to) {
    // Get count
    const { count } = await supabaseClient
        .from('day_order')
        .select('*', { count: 'exact', head: true });
    
    // Get paginated data
    const { data, error } = await supabaseClient
        .from('day_order')
        .select('*')
        .order('id', { ascending: true })
        .range(from, to);
    
    if (error) throw error;
    
    const enrichedData = data.map(record => {
        const dept = record.department_id ? departmentMap[record.department_id] : {};
        return {
            ...record,
            department_name: dept.name || ''
        };
    });
    
    return { data: enrichedData, count };
}


async function loadOtherTableData(table, from, to) {
    let orderBy = 'id';
    
    if (table === 'trainers') {
        orderBy = 'trainer_id';
    } else if (table === 'sessions') {
        orderBy = 'id';
    }
    
    // Get count
    const { count } = await supabaseClient
        .from(table)
        .select('*', { count: 'exact', head: true });
    
    // Get paginated data with explicit limit
    const { data, error } = await supabaseClient
        .from(table)
        .select('*')
        .order(orderBy, { ascending: true })
        .range(from, to)
        .limit(10000);  // ← ADD THIS
    
    if (error) throw error;
    
    return { data, count };
}




// ==========================================
// TABLE RENDERING
// ==========================================
function renderTable(table, data) {
    const tableEl = document.getElementById(table + '-table');
    
    if (!data || data.length === 0) {
        tableEl.innerHTML = '<tbody><tr><td colspan="10" class="text-center">No records found</td></tr></tbody>';
        return;
    }
    
    let columns = [];
    let html = '';
    
    // Define columns for each table
    if (table === 'attendance') {
        columns = ['roll_number', 'student_name', 'department_name', 'date', 'session_name', 'present'];
        html = renderAttendanceTable(data, columns);
    } else if (table === 'attendance_sessions') {
        columns = ['id', 'department_name', 'trainer_name', 'topic_name', 'date', 'session_name', 'vendor', 'duration'];
        html = renderAttendanceSessionsTable(data, columns);
    } else if (table === 'students') {
        columns = ['roll_number', 'name', 'department_name', 'active'];
        html = renderGenericTable(data, columns, table);
    } else if (table === 'trainers') {
        columns = ['trainer_id', 'name', 'mail_id', 'vendor'];
        html = renderGenericTable(data, columns, table);
    } else if (table === 'topics') {
        columns = ['id', 'topic_name', 'year'];
        html = renderGenericTable(data, columns, table);
    } else if (table === 'departments') {
        columns = ['id', 'name', 'year'];
        html = renderGenericTable(data, columns, table);
    } else if (table === 'day_order') {
        columns = ['id', 'vendor', 'day_order', 'department_name'];
        html = renderGenericTable(data, columns, table);
    } else if (table === 'sessions') {
        columns = ['id', 'session'];
        html = renderGenericTable(data, columns, table);
    }
    
    tableEl.innerHTML = html;
}

function renderAttendanceTable(data, columns) {
    const columnLabels = {
        roll_number: 'Roll Number',
        student_name: 'Student Name',
        department_name: 'Department',
        date: 'Date',
        session_name: 'Session',
        present: 'Status'
    };
    
    // Calculate starting serial number based on current page
    const startSerialNumber = ((currentPage[currentTable] || 1) - 1) * pageSize + 1;
    
    let html = '<thead><tr>';
    html += '<th>S.No</th>'; // Add S.No column
    columns.forEach(col => {
        html += `<th>${columnLabels[col] || col}</th>`;
    });
    html += '<th>Actions</th></tr></thead><tbody>';
    
    data.forEach((row, index) => {
        html += '<tr>';
        html += `<td>${startSerialNumber + index}</td>`; // Serial number
        columns.forEach(col => {
            if (col === 'present') {
            // Determine if mainly present or absent for styling
            const isPresent = row[col] === 'P' || row[col]?.startsWith('P:');
            
            html += `<td>
                <span class="status-badge ${isPresent ? 'present' : 'absent'}">
                    <span class="status-icon">${isPresent ? '✓' : '✗'}</span>
                    ${row[col]}
                </span>
            </td>`;
            } else {
                html += `<td>${row[col] || ''}</td>`;
            }
        });
        html += `<td><div class="action-icons">
            <button class="btn-primary btn-small" onclick='editAttendanceRecord(${JSON.stringify(row)})'>Edit</button>
        </div></td>`;
        html += '</tr>';
    });
    
    html += '</tbody>';
    return html;
}

// Render attendance sessions table
// Render attendance sessions table
function renderAttendanceSessionsTable(data, columns) {
    const columnLabels = {
        id: 'ID',
        department_name: 'Department',
        trainer_name: 'Trainer',
        topic_name: 'Topic',
        date: 'Date',
        session_name: 'Session',
        vendor: 'Vendor',
        duration: 'Duration (hrs)' 
    };
    
    // Calculate starting serial number based on current page
    const startSerialNumber = ((currentPage[currentTable] || 1) - 1) * pageSize + 1;
    
    let html = '<thead><tr>';
    html += '<th>S.No</th>'; // Add S.No column
    columns.forEach(col => {
        // Skip ID column since we're using S.No instead
        if (col !== 'id') {
            html += `<th>${columnLabels[col] || col}</th>`;
        }
    });
    html += '<th>Actions</th></tr></thead><tbody>';
    
    data.forEach((row, index) => {
        html += '<tr>';
        html += `<td>${startSerialNumber + index}</td>`; // Serial number
        columns.forEach(col => {
            // Skip ID column
            if (col !== 'id') {
                html += `<td>${row[col] || ''}</td>`;
            }
        });
        html += `<td><div class="action-icons">
            <button class="btn-primary btn-small" onclick='editRecord(${JSON.stringify(row)}, "attendance_sessions")'>Edit</button>
        </div></td>`;
        html += '</tr>';
    });
    
    html += '</tbody>';
    return html;
}

// Render generic table (for tables without delete)
// Render generic table (for tables without delete)
function renderGenericTable(data, columns, table) {
    // Calculate starting serial number based on current page
    const startSerialNumber = ((currentPage[table] || 1) - 1) * pageSize + 1;
    
    let html = '<thead><tr>';
    html += '<th>S.No</th>'; // Add S.No column
    columns.forEach(col => {
        // For these tables, skip the id column and show S.No instead
        if (table === 'topics' || table === 'departments' || table === 'day_order' || table === 'sessions') {
            if (col !== 'id') {
                html += `<th>${formatColumnName(col)}</th>`;
            }
        } else {
            html += `<th>${formatColumnName(col)}</th>`;
        }
    });
    html += '<th>Actions</th></tr></thead><tbody>';
    
    data.forEach((row, index) => {
        html += '<tr>';
        html += `<td>${startSerialNumber + index}</td>`; // Serial number
        columns.forEach(col => {
            // Skip id column for these tables
            if (table === 'topics' || table === 'departments' || table === 'day_order' || table === 'sessions') {
                if (col === 'id') return; // Skip id column
            }
            
            let value = row[col];
            if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            }
            html += `<td>${value !== null && value !== undefined ? value : ''}</td>`;
        });
        
        const idField = table === 'students' ? 'roll_number' : table === 'trainers' ? 'trainer_id' : 'id';
        html += `<td><div class="action-icons">
            <button class="btn-primary btn-small" onclick='editRecord(${JSON.stringify(row)}, "${table}")'>Edit</button>
        </div></td>`;
        html += '</tr>';
    });
    
    html += '</tbody>';
    return html;
}

function formatColumnName(col) {
    return col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}




// ==========================================
// FILTERS
// ==========================================
function toggleFilters(table) {
    const panel = document.getElementById(table + '-filter-panel') || 
                  document.querySelector(`#${table} .filter-panel`);
    if (panel) {
        panel.classList.toggle('collapsed');
    }
}

let fullDataCache = {};

async function applyFilters(table) {
    currentPage[table] = 1;
    fullDataCache[table] = null;
    
    // *** ADD WARNING FOR LARGE QUERIES ***
    if (table === 'attendance') {
        const filters = buildAttendanceFilters();
        const sizeEstimate = estimateResultSize(table, filters);
        
        if (sizeEstimate && sizeEstimate.warning) {
            showMessage(table, sizeEstimate.message, 'info');
        }
    }
    
    await loadDataWithFilters(table, 1);
    updateFilterCount(table);
    saveState();
}

async function loadDataWithFilters(table, page = 1) {
    try {
        const tableEl = document.getElementById(table + '-table');
        tableEl.innerHTML = '<tbody><tr><td colspan="10" class="loading">Loading data...</td></tr></tbody>';
        
        currentPage[table] = page;
        
        // Get filters first
        let filters;
        if (table === 'attendance') {
            filters = buildAttendanceFilters();
        } else if (table === 'attendance_sessions') {
            filters = buildSessionsFilters();
        } else if (table === 'students') {
            filters = buildStudentsFilters();
        } else if (table === 'trainers') {
            filters = buildTrainersFilters();
        } else if (table === 'topics') {
            filters = buildTopicsFilters();
        } else if (table === 'departments') {
            filters = buildDepartmentsFilters();
        } else if (table === 'day_order') {
            filters = buildDayOrderFilters();
        }
        
        // *** SPECIAL HANDLING FOR ATTENDANCE TABLE ***
        if (table === 'attendance') {
            // STEP 1: Get matching session IDs based on date filter
            let sessionIds = [];
            
            if (filters.dateFrom || filters.dateTo) {
                let sessionQuery = supabaseClient
                    .from('attendance_sessions')
                    .select('id');
                
                if (filters.dateFrom) sessionQuery = sessionQuery.gte('date', filters.dateFrom);
                if (filters.dateTo) sessionQuery = sessionQuery.lte('date', filters.dateTo);
                
                const { data: matchingSessions, error: sessionError } = await sessionQuery;
                
                if (sessionError) throw sessionError;
                
                sessionIds = matchingSessions.map(s => s.id);
                
                // If no sessions match the date range, return empty
                if (sessionIds.length === 0) {
                    filteredData[table] = [];
                    totalRecords[table] = 0;
                    dataLoaded[table] = true;
                    renderTable(table, []);
                    renderPagination(table);
                    return;
                }
            }
            
            // STEP 2: Load attendance records filtered by session_id
            const batchSize = 1000;
            let allData = [];
            let offset = 0;
            let hasMore = true;
            
            let selectQuery = `*, attendance_sessions(date, session_id, department_id), students(name, department_id)`;
            
            while (hasMore) {
                let query = supabaseClient.from(table)
                    .select(selectQuery)
                    .order('id', { ascending: true })
                    .range(offset, offset + batchSize - 1);
                
                // Apply roll and present filters
                if (filters.roll) query = query.ilike('roll_number', `%${filters.roll}%`);
                if (filters.present !== '') query = query.eq('present', filters.present);
                
                // *** KEY FIX: Filter by session_id array ***
                if (sessionIds.length > 0) {
                    query = query.in('session_id', sessionIds);
                }
                
                const { data, error } = await query;
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allData = allData.concat(data);
                    offset += batchSize;
                    
                    if (allData.length > batchSize) {
                        tableEl.innerHTML = `<tbody><tr><td colspan="10" class="loading">Loading data... ${allData.length} records loaded</td></tr></tbody>`;
                    }
                    
                    if (data.length < batchSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            }
            
            // Enrich and filter
            let enrichedData = await enrichData(table, allData);
            let allFilteredResults = applyClientFilters(table, enrichedData);
            
            // Store and paginate
            filteredData[table] = allFilteredResults;
            totalRecords[table] = allFilteredResults.length;
            dataLoaded[table] = true;
            
            const from = (page - 1) * pageSize;
            const to = from + pageSize;
            const paginatedData = allFilteredResults.slice(from, to);
            
            renderTable(table, paginatedData);
            renderPagination(table);
            
        } else {
            // *** FOR OTHER TABLES: Use existing logic ***
            const batchSize = 1000;
            let allData = [];
            let offset = 0;
            let hasMore = true;
            
            let orderBy = table === 'trainers' ? 'trainer_id' : table === 'students' ? 'roll_number' : 'id';
            
            let selectQuery = '*';
            
            while (hasMore) {
                let query = supabaseClient.from(table)
                    .select(selectQuery)
                    .order(orderBy, { ascending: true })
                    .range(offset, offset + batchSize - 1);
                
                query = applyDatabaseFilters(query, filters, table);
                
                const { data, error } = await query;
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allData = allData.concat(data);
                    offset += batchSize;
                    
                    if (allData.length > batchSize) {
                        tableEl.innerHTML = `<tbody><tr><td colspan="10" class="loading">Loading data... ${allData.length} records loaded</td></tr></tbody>`;
                    }
                    
                    if (data.length < batchSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            }
            
            let enrichedData = await enrichData(table, allData);
            let allFilteredResults = applyClientFilters(table, enrichedData);
            
            const from = (page - 1) * pageSize;
            const to = from + pageSize;
            const paginatedData = allFilteredResults.slice(from, to);
            
            filteredData[table] = allFilteredResults;
            totalRecords[table] = allFilteredResults.length;
            dataLoaded[table] = true;
            
            renderTable(table, paginatedData);
            renderPagination(table);
        }
        
    } catch (error) {
        showMessage(table, 'Error applying filters: ' + error.message, 'error');
        console.error('Filter error details:', error);
    }
}

// NEW: Apply only database-level filters (fields that exist in DB)
function applyDatabaseFilters(query, filters, table) {
    if (table === 'attendance') {
        // TEXT FILTERS
        if (filters.roll) query = query.ilike('roll_number', `%${filters.roll}%`);
        if (filters.present !== '') query = query.eq('present', filters.present);
        
        // *** CORRECTED DATE FILTERING ***
        // Unfortunately, Supabase does NOT support filtering on joined table fields directly
        // We need to filter by session_id instead
        
        // If date filters are provided, we need a different approach:
        // Option 1: Get session IDs that match the date range first, then filter attendance
        // Option 2: Keep date filtering client-side (but after loading matching sessions)
        
        // For now, we'll use a workaround: filter by session_id if available
        // The REAL solution is to add date filters in loadDataWithFilters differently
        
    } else if (table === 'attendance_sessions') {
        // Keep existing session filters
        if (filters.dateFrom) query = query.gte('date', filters.dateFrom);
        if (filters.dateTo) query = query.lte('date', filters.dateTo);
        
    } else if (table === 'students') {
        if (filters.roll) query = query.ilike('roll_number', `%${filters.roll}%`);
        if (filters.name) query = query.ilike('name', `%${filters.name}%`);
        
        if (filters.depts && filters.depts.length > 0) {
            const deptIds = departments
                .filter(d => filters.depts.includes(d.name))
                .map(d => d.id);
            
            if (deptIds.length > 0) {
                query = query.in('department_id', deptIds);
            }
        }
    } else if (table === 'trainers') {
        // Trainers filters are client-side
    } else if (table === 'topics') {
        if (filters.years && filters.years.length > 0) {
            query = query.in('year', filters.years);
        }
    } else if (table === 'departments') {
        if (filters.names && filters.names.length > 0) {
            query = query.in('name', filters.names);
        }
        if (filters.years && filters.years.length > 0) {
            query = query.in('year', filters.years);
        }
    } else if (table === 'day_order') {
        if (filters.vendors && filters.vendors.length > 0) {
            query = query.in('vendor', filters.vendors);
        }
        if (filters.dayOrders && filters.dayOrders.length > 0) {
            query = query.in('day_order', filters.dayOrders);
        }
        
        if (filters.depts && filters.depts.length > 0) {
            const deptIds = departments
                .filter(d => filters.depts.includes(d.name))
                .map(d => d.id);
            
            if (deptIds.length > 0) {
                query = query.in('department_id', deptIds);
            }
        }
    }
    
    return query;
}

// NEW: Apply client-side filters (enriched fields)
function applyClientFilters(table, data) {
    let filtered = data;
    
    if (table === 'attendance') {
        const filters = buildAttendanceFilters();
        if (filters.name) filtered = filtered.filter(r => r.student_name.toLowerCase().includes(filters.name));
        if (filters.depts.length > 0) filtered = filtered.filter(r => filters.depts.includes(r.department_name));
        if (filters.sessions.length > 0) filtered = filtered.filter(r => filters.sessions.includes(r.session_name));
        
        // *** REMOVED DATE FILTERING - NOW HANDLED AT DATABASE LEVEL ***
        // Delete these lines:
        // if (filters.dateFrom) filtered = filtered.filter(r => r.date >= filters.dateFrom);
        // if (filters.dateTo) filtered = filtered.filter(r => r.date <= filters.dateTo);
        
    } else if (table === 'attendance_sessions') {
        const filters = buildSessionsFilters();
        if (filters.depts.length > 0) filtered = filtered.filter(r => filters.depts.includes(r.department_name));
        if (filters.trainers.length > 0) {
            const trainerIds = filters.trainers.map(name => trainers.find(t => t.name === name)?.trainer_id).filter(Boolean);
            filtered = filtered.filter(r => trainerIds.includes(r.trainer_id));
        }
        if (filters.topics.length > 0) filtered = filtered.filter(r => filters.topics.includes(r.topic_name));
        if (filters.sessions.length > 0) filtered = filtered.filter(r => filters.sessions.includes(r.session_name));
        if (filters.vendors.length > 0) filtered = filtered.filter(r => filters.vendors.includes(r.vendor));
    } else if (table === 'trainers') {
        const filters = buildTrainersFilters();
        if (filters.names.length > 0) filtered = filtered.filter(r => filters.names.includes(r.name));
        if (filters.vendors.length > 0) filtered = filtered.filter(r => filters.vendors.includes(r.vendor));
    }
    
    return filtered;
}

function estimateResultSize(table, filters) {
    // Only for attendance table
    if (table !== 'attendance') return null;
    
    if (!filters.dateFrom && !filters.dateTo) {
        return { estimated: 15000, warning: true, message: "No date filter applied. This may load 10,000+ records." };
    }
    
    // Calculate days in range
    const start = filters.dateFrom ? new Date(filters.dateFrom) : new Date('2020-01-01');
    const end = filters.dateTo ? new Date(filters.dateTo) : new Date();
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    // Rough estimate: 50-100 records per day
    const estimated = days * 75;
    
    if (estimated > 5000) {
        return { 
            estimated, 
            warning: true, 
            message: `Large date range (${days} days). This may take a moment to load.` 
        };
    }
    
    return { estimated, warning: false };
}

// NEW: Enrich data helper
async function enrichData(table, data) {
    if (table === 'attendance') {
        return data.map(record => {
            // Use the joined students data
            const student = record.students || {};
            const dept = student.department_id ? departmentMap[student.department_id] : {};
            const session = record.attendance_sessions?.session_id ? sessionMap[record.attendance_sessions.session_id] : {};
            return {
                ...record,
                student_name: student.name || 'Unknown',
                department_name: dept.name || 'Unknown',
                date: record.attendance_sessions?.date || '',
                session_name: session.session || 'Unknown'
            };
        });
    } else if (table === 'attendance_sessions') {
    return data.map(record => {
        const dept = record.department_id ? departmentMap[record.department_id] : {};
        const trainer = trainerMap[record.trainer_id] || {};
        const topic = record.topic_id ? topicMap[record.topic_id] : {};
        const session = sessionMap[record.session_id] || {};
        return {
            ...record,
            department_name: dept.name || '',
            trainer_name: trainer.name || '',
            vendor: record.vendor || trainer.vendor || '',  // ← CHANGED: Use record.vendor first, then fallback
            topic_name: topic.topic_name || '',
            session_name: session.session || '',
            duration: record.duration || '2.00'
        };
    });
    }else if (table === 'students') {
        return data.map(student => {
            const dept = student.department_id ? departmentMap[student.department_id] : {};
            return { ...student, department_name: dept.name || '' };
        });
    } else if (table === 'day_order') {
        return data.map(record => {
            const dept = record.department_id ? departmentMap[record.department_id] : {};
            return { ...record, department_name: dept.name || '' };
        });
    }
    return data;
}


// Build filter objects from form inputs
function buildAttendanceFilters() {
    return {
        roll: document.getElementById('filter-att-roll')?.value.toLowerCase(),
        name: document.getElementById('filter-att-name')?.value.toLowerCase(),
        depts: multiSelectState['att-dept'] || [],
        dateFrom: document.getElementById('filter-att-date-from')?.value,
        dateTo: document.getElementById('filter-att-date-to')?.value,
        sessions: multiSelectState['att-session'] || [],
        present: document.getElementById('filter-att-present')?.value
    };
}

function applyAttendanceFiltersToQuery(query, filters) {
    if (filters.roll) {
        query = query.ilike('roll_number', `%${filters.roll}%`);
    }
    if (filters.present !== '') {
        query = query.eq('present', filters.present);
    }
    // Note: Session ID filter needs to be on session_id field
    // Name, dept, date, session filters need client-side filtering after enrichment
    return query;
}

function buildSessionsFilters() {
    return {
        dateFrom: document.getElementById('filter-sess-date-from')?.value,
        dateTo: document.getElementById('filter-sess-date-to')?.value,
        depts: multiSelectState['sess-dept'] || [],
        trainers: multiSelectState['sess-trainer'] || [],
        topics: multiSelectState['sess-topic'] || [],
        vendors: multiSelectState['sess-vendor'] || [],
        sessions: multiSelectState['sess-session'] || []
    };
}

function applySessionsFiltersToQuery(query, filters) {
    if (filters.dateFrom) {
        query = query.gte('date', filters.dateFrom);
    }
    if (filters.dateTo) {
        query = query.lte('date', filters.dateTo);
    }
    // Department, trainer, topic, session, vendor need client-side filtering after enrichment
    return query;
}

function buildStudentsFilters() {
    return {
        roll: document.getElementById('filter-stud-roll')?.value.toLowerCase(),
        name: document.getElementById('filter-stud-name')?.value.toLowerCase(),
        depts: multiSelectState['stud-dept'] || []
    };
}

function applyStudentsFiltersToQuery(query, filters) {
    if (filters.roll) {
        query = query.ilike('roll_number', `%${filters.roll}%`);
    }
    if (filters.name) {
        query = query.ilike('name', `%${filters.name}%`);
    }
    // Department needs client-side filtering after enrichment
    return query;
}

function buildTrainersFilters() {
    return {
        names: multiSelectState['train-name'] || [],
        vendors: multiSelectState['train-vendor'] || []
    };
}

function applyTrainersFiltersToQuery(query, filters) {
    // These will be filtered client-side after loading
    return query;
}

function applyTrainersFiltersToQuery(query, filters) {
    if (filters.id) {
        query = query.ilike('trainer_id', `%${filters.id}%`);
    }
    if (filters.name) {
        query = query.ilike('name', `%${filters.name}%`);
    }
    if (filters.vendor) {
        query = query.ilike('vendor', `%${filters.vendor}%`);
    }
    return query;
}

function buildTopicsFilters() {
    return {
        years: multiSelectState['topic-year'] || []
    };
}

function applyTopicsFiltersToQuery(query, filters) {
    if (filters.years.length > 0) {
        query = query.in('year', filters.years);
    }
    return query;
}

function applyTopicsFiltersToQuery(query, filters) {
    if (filters.name) {
        query = query.ilike('topic_name', `%${filters.name}%`);
    }
    return query;
}

function buildDepartmentsFilters() {
    return {
        names: multiSelectState['dept-name'] || [],
        years: multiSelectState['dept-year'] || []
    };
}

function applyDepartmentsFiltersToQuery(query, filters) {
    if (filters.names.length > 0) {
        query = query.in('name', filters.names);
    }
    if (filters.years.length > 0) {
        query = query.in('year', filters.years);
    }
    return query;
}


function buildDayOrderFilters() {
    return {
        vendors: multiSelectState['day-vendor'] || [],
        dayOrders: multiSelectState['day-order'] || [],
        depts: multiSelectState['day-dept'] || []
    };
}

function applyDayOrderFiltersToQuery(query, filters) {
    if (filters.vendors.length > 0) {
        query = query.in('vendor', filters.vendors);
    }
    if (filters.dayOrders.length > 0) {
        query = query.in('day_order', filters.dayOrders);
    }
    // Department needs client-side filtering after enrichment
    return query;
}


function applyDepartmentsFiltersToQuery(query, filters) {
    if (filters.name) {
        query = query.ilike('name', `%${filters.name}%`);
    }
    if (filters.year) {
        query = query.eq('year', parseInt(filters.year));
    }
    return query;
}



function applyDayOrderFiltersToQuery(query, filters) {
    if (filters.vendor) {
        query = query.ilike('vendor', `%${filters.vendor}%`);
    }
    // Department needs client-side filtering after enrichment
    return query;
}

function renderPagination(table) {
    const container = document.getElementById(table + '-pagination');
    if (!container) return;
    
    const total = totalRecords[table] || 0;
    const current = currentPage[table] || 1;
    const totalPages = Math.ceil(total / pageSize);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<div class="pagination">';
    
    // Previous button
    html += `<button onclick="changePage('${table}', ${current - 1})" ${current === 1 ? 'disabled' : ''}>← Previous</button>`;
    
    // Page numbers
    const startPage = Math.max(1, current - 2);
    const endPage = Math.min(totalPages, current + 2);
    
    if (startPage > 1) {
        html += `<button onclick="changePage('${table}', 1)">1</button>`;
        if (startPage > 2) html += '<span>...</span>';
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button onclick="changePage('${table}', ${i})" class="${i === current ? 'active' : ''}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span>...</span>';
        html += `<button onclick="changePage('${table}', ${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button onclick="changePage('${table}', ${current + 1})" ${current === totalPages ? 'disabled' : ''}>Next →</button>`;
    
    html += `<div class="pagination-info">Showing ${(current - 1) * pageSize + 1}-${Math.min(current * pageSize, total)} of ${total}</div>`;
    html += '</div>';
    
    container.innerHTML = html;
}

async function changePage(table, page) {
    if (page < 1) return;
    const totalPages = Math.ceil((totalRecords[table] || 0) / pageSize);
    if (page > totalPages) return;
    
    currentPage[table] = page;
    
    // Just slice the already-loaded filtered data
    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    const paginatedData = (filteredData[table] || []).slice(from, to);
    
    renderTable(table, paginatedData);
    renderPagination(table);
    
    saveState();
}



function applyAttendanceFilters(data) {
    let filtered = data;
    
    // Roll number
    const roll = document.getElementById('filter-att-roll')?.value.toLowerCase();
    if (roll) {
        filtered = filtered.filter(r => r.roll_number.toLowerCase().includes(roll));
    }
    
    // Name
    const name = document.getElementById('filter-att-name')?.value.toLowerCase();
    if (name) {
        filtered = filtered.filter(r => r.student_name.toLowerCase().includes(name));
    }
    
    // Department
    const depts = multiSelectState['att-dept'] || [];
    if (depts.length > 0) {
        filtered = filtered.filter(r => depts.includes(r.department_name));
    }
    
    // Date range
    const dateFrom = document.getElementById('filter-att-date-from')?.value;
    const dateTo = document.getElementById('filter-att-date-to')?.value;
    if (dateFrom) {
        filtered = filtered.filter(r => r.date >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(r => r.date <= dateTo);
    }
    
    // Session
    const sessionNames = multiSelectState['att-session'] || [];
    if (sessionNames.length > 0) {
        filtered = filtered.filter(r => sessionNames.includes(r.session_name));
    }
    
    // Present status
    const present = document.getElementById('filter-att-present')?.value;
    if (present !== '') {
        const isPresent = present === 'true';
        filtered = filtered.filter(r => r.present === isPresent);
    }
    
    return filtered;
}

function applySessionsFilters(data) {
    let filtered = data;
    
    // Date range
    const dateFrom = document.getElementById('filter-sess-date-from')?.value;
    const dateTo = document.getElementById('filter-sess-date-to')?.value;
    if (dateFrom) {
        filtered = filtered.filter(r => r.date >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(r => r.date <= dateTo);
    }
    
    // Department
    const depts = multiSelectState['sess-dept'] || [];
    if (depts.length > 0) {
        filtered = filtered.filter(r => depts.includes(r.department_name));
    }
    
    // Trainer
    const trainers = multiSelectState['sess-trainer'] || [];
    if (trainers.length > 0) {
        filtered = filtered.filter(r => trainers.includes(r.trainer_name));
    }
    
    // Topic
    const topics = multiSelectState['sess-topic'] || [];
    if (topics.length > 0) {
        filtered = filtered.filter(r => topics.includes(r.topic_name));
    }
    
    // Vendor
    const vendor = document.getElementById('filter-sess-vendor')?.value.toLowerCase();
    if (vendor) {
        filtered = filtered.filter(r => r.vendor?.toLowerCase().includes(vendor));
    }
    
    // Session
    const sessions = multiSelectState['sess-session'] || [];
    if (sessions.length > 0) {
        filtered = filtered.filter(r => sessions.includes(r.session_name));
    }
    
    return filtered;
}

function applyStudentsFilters(data) {
    let filtered = data;
    
    const roll = document.getElementById('filter-stud-roll')?.value.toLowerCase();
    if (roll) {
        filtered = filtered.filter(r => r.roll_number.toLowerCase().includes(roll));
    }
    
    const name = document.getElementById('filter-stud-name')?.value.toLowerCase();
    if (name) {
        filtered = filtered.filter(r => r.name.toLowerCase().includes(name));
    }
    
    const depts = multiSelectState['stud-dept'] || [];
    if (depts.length > 0) {
        filtered = filtered.filter(r => depts.includes(r.department_name));
    }
    
    return filtered;
}

function applyTrainersFilters(data) {
    let filtered = data;
    
    const names = multiSelectState['train-name'] || [];
    if (names.length > 0) {
        filtered = filtered.filter(r => names.includes(r.name));
    }
    
    const vendors = multiSelectState['train-vendor'] || [];
    if (vendors.length > 0) {
        filtered = filtered.filter(r => vendors.includes(r.vendor));
    }
    
    return filtered;
}

function applyTopicsFilters(data) {
    let filtered = data;
    
    const name = document.getElementById('filter-topic-name')?.value.toLowerCase();
    if (name) {
        filtered = filtered.filter(r => (r.topic_name || '').toLowerCase().includes(name));
    }
    
    return filtered;
}

function applyDayOrderFilters(data) {
    let filtered = data;
    
    const vendors = multiSelectState['day-vendor'] || [];
    if (vendors.length > 0) {
        filtered = filtered.filter(r => vendors.includes(r.vendor));
    }
    
    const dayOrders = multiSelectState['day-order'] || [];
    if (dayOrders.length > 0) {
        filtered = filtered.filter(r => dayOrders.includes(String(r.day_order)));
    }
    
    const depts = multiSelectState['day-dept'] || [];
    if (depts.length > 0) {
        filtered = filtered.filter(r => depts.includes(r.department_name));
    }
    
    return filtered;
}

function clearFilters(table) {
    // Clear input fields
    document.querySelectorAll(`#${table} input[type="text"], #${table} input[type="date"], #${table} select`).forEach(el => {
        el.value = '';
    });
    
    // FIXED: Better logic to identify which multiselects belong to this table
    Object.keys(multiSelectState).forEach(key => {
        let belongsToTable = false;
        
        if (table === 'attendance') {
            belongsToTable = key.startsWith('att-');
        } else if (table === 'attendance_sessions') {
            belongsToTable = key.startsWith('sess-');
        } else if (table === 'students') {
            belongsToTable = key.startsWith('stud-');
        } else if (table === 'trainers') {
            belongsToTable = key.startsWith('train-');
        } else if (table === 'topics') {
            belongsToTable = key.startsWith('topic-');
        } else if (table === 'departments') {
            belongsToTable = key.startsWith('dept-');
        } else if (table === 'day_order') {
            belongsToTable = key.startsWith('day-');
        }
        
        if (belongsToTable) {
            multiSelectState[key] = [];
            
            // Uncheck all checkboxes
            const checkboxes = document.querySelectorAll(`#${key}-options input[type="checkbox"]`);
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            
            // Update display
            updateMultiselectDisplay(key);
        }
    });
    
    // Show filter message instead of all data
    showFilterMessage(table);
    
    // Mark data as not loaded so filters must be applied again
    dataLoaded[table] = false;
    
    // Clear the filteredData for this table
    filteredData[table] = [];
    totalRecords[table] = 0;
    currentPage[table] = 1;
    
    updateFilterCount(table);
    
    // Save state after clearing filters
    saveState();
}

function clearFiltersForTable(table) {
    // Clear input fields for this specific table
    document.querySelectorAll(`#${table} input[type="text"], #${table} input[type="date"], #${table} select`).forEach(el => {
        el.value = '';
    });
    
    // FIXED: Better logic to identify which multiselects belong to this table
    Object.keys(multiSelectState).forEach(key => {
        let belongsToTable = false;
        
        if (table === 'attendance') {
            belongsToTable = key.startsWith('att-');
        } else if (table === 'attendance_sessions') {
            belongsToTable = key.startsWith('sess-');
        } else if (table === 'students') {
            belongsToTable = key.startsWith('stud-');
        } else if (table === 'trainers') {
            belongsToTable = key.startsWith('train-');
        } else if (table === 'topics') {
            belongsToTable = key.startsWith('topic-');
        } else if (table === 'departments') {
            belongsToTable = key.startsWith('dept-');
        } else if (table === 'day_order') {
            belongsToTable = key.startsWith('day-');
        }
        
        if (belongsToTable) {
            multiSelectState[key] = [];
            
            // Uncheck all checkboxes
            const checkboxes = document.querySelectorAll(`#${key}-options input[type="checkbox"]`);
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            
            // Update display
            updateMultiselectDisplay(key);
        }
    });
    
    updateFilterCount(table);
}

function updateFilterCount(table) {
    const badge = document.getElementById(table + '-filter-count') || 
                  document.getElementById(table.split('_')[0] + '-filter-count');
    if (!badge) return;
    
    let count = 0;
    
    // Count active filters based on table type
    document.querySelectorAll(`#${table} input[type="text"], #${table} input[type="date"]`).forEach(el => {
        if (el.value) count++;
    });
    
    document.querySelectorAll(`#${table} select`).forEach(el => {
        if (el.value) count++;
    });
    
    Object.keys(multiSelectState).forEach(key => {
        if (key.startsWith(table.substring(0, 4)) && multiSelectState[key].length > 0) {
            count++;
        }
    });
    
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ==========================================
// DATE RANGE QUICK FILTERS
// ==========================================
function setDateRange(table, range) {
    const today = new Date();
    let fromDate, toDate;
    
    if (range === 'today') {
        fromDate = toDate = formatDate(today);
    } else if (range === 'week') {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        fromDate = formatDate(weekStart);
        toDate = formatDate(today);
    } else if (range === 'month') {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        fromDate = formatDate(monthStart);
        toDate = formatDate(today);
    }
    
    if (table === 'attendance') {
        document.getElementById('filter-att-date-from').value = fromDate;
        document.getElementById('filter-att-date-to').value = toDate;
    } else if (table === 'attendance_sessions') {
        document.getElementById('filter-sess-date-from').value = fromDate;
        document.getElementById('filter-sess-date-to').value = toDate;
    }
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// ==========================================
// MULTISELECT DROPDOWNS
// ==========================================
function initializeMultiselects() {
    // Attendance filters
    populateMultiselect('att-dept', departments.map(d => d.name));
    populateMultiselect('att-session', sessions.map(s => s.session));
    
    // Session filters
    populateMultiselect('sess-dept', departments.map(d => d.name));
    populateMultiselect('sess-trainer', trainers.map(t => t.name));
    populateMultiselect('sess-topic', topics.map(t => t.topic_name));
    populateMultiselect('sess-session', sessions.map(s => s.session));
    
    
    // Session filters
    populateMultiselect('sess-dept', departments.map(d => d.name));
    populateMultiselect('sess-trainer', trainers.map(t => t.name));
    populateMultiselect('sess-topic', topics.map(t => t.topic_name));
    populateMultiselect('sess-session', sessions.map(s => s.session));
    populateMultiselect('sess-vendor', [...new Set(trainers.map(t => t.vendor))].filter(Boolean)); // ADD THIS LINE
        
    // Student filters
    populateMultiselect('stud-dept', departments.map(d => d.name));
    
    // Trainer filters
    populateMultiselect('train-name', trainers.map(t => t.name));
    populateMultiselect('train-vendor', [...new Set(trainers.map(t => t.vendor))].filter(Boolean));
    
    // Topic filters
    populateMultiselect('topic-year', [...new Set(topics.map(t => t.year))].filter(y => y != null).sort());
    
    // Department filters
    populateMultiselect('dept-name', departments.map(d => d.name));
    populateMultiselect('dept-year', [...new Set(departments.map(d => d.year))].filter(y => y != null).sort());
    
    // Day order filters
    populateMultiselect('day-vendor', [...new Set(allData['day_order']?.map(d => d.vendor) || [])].filter(Boolean));
    populateMultiselect('day-order', [...new Set(allData['day_order']?.map(d => d.day_order) || [])].filter(Boolean).sort());
    populateMultiselect('day-dept', departments.map(d => d.name));
}

function populateMultiselect(id, options) {
    const container = document.getElementById(id + '-options');
    if (!container) return;
    
    if (!multiSelectState[id]) {
        multiSelectState[id] = [];
    }
    
    let html = '';
    options.forEach(option => {
        if (option) {
            const escapedOption = escapeHtml(option);
            html += `
                <div class="multiselect-option">
                    <input type="checkbox" 
                           id="${id}-${escapedOption}" 
                           value="${escapedOption}"
                           onchange="handleMultiselectChange('${id}', '${escapedOption}')">
                    <label for="${id}-${escapedOption}">${option}</label>
                </div>
            `;
        }
    });
    container.innerHTML = html;
}

function toggleMultiselect(id) {
    const dropdown = document.getElementById(id + '-dropdown');
    if (!dropdown) return;
    
    // Close all other dropdowns
    document.querySelectorAll('.multiselect-dropdown').forEach(d => {
        if (d.id !== id + '-dropdown') {
            d.classList.remove('active');
        }
    });
    
    dropdown.classList.toggle('active');
}

function toggleMultiselectOption(id, option) {
    const checkbox = document.getElementById(`${id}-${option}`);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
    }
    
    if (!multiSelectState[id]) {
        multiSelectState[id] = [];
    }
    
    const index = multiSelectState[id].indexOf(option);
    if (index > -1) {
        multiSelectState[id].splice(index, 1);
    } else {
        multiSelectState[id].push(option);
    }
    
    updateMultiselectDisplay(id);
}

function handleMultiselectChange(id, option) {
    const checkbox = document.getElementById(`${id}-${option}`);
    if (!checkbox) return;
    
    if (!multiSelectState[id]) {
        multiSelectState[id] = [];
    }
    
    const index = multiSelectState[id].indexOf(option);
    
    // Update state based on checkbox's CURRENT state (after browser toggled it)
    if (checkbox.checked && index === -1) {
        // Checkbox is now checked, add to state
        multiSelectState[id].push(option);
    } else if (!checkbox.checked && index > -1) {
        // Checkbox is now unchecked, remove from state
        multiSelectState[id].splice(index, 1);
    }
    
    updateMultiselectDisplay(id);
}

function selectAllMulti(id) {
    const checkboxes = document.querySelectorAll(`#${id}-options input[type="checkbox"]`);
    multiSelectState[id] = [];
    
    checkboxes.forEach(cb => {
        cb.checked = true;
        const option = cb.id.replace(id + '-', '');
        multiSelectState[id].push(option);
    });
    
    updateMultiselectDisplay(id);
}

function clearAllMulti(id) {
    const checkboxes = document.querySelectorAll(`#${id}-options input[type="checkbox"]`);
    checkboxes.forEach(cb => cb.checked = false);
    multiSelectState[id] = [];
    updateMultiselectDisplay(id);
}

function updateMultiselectDisplay(id) {
    const display = document.getElementById(id + '-display');
    const tagsContainer = document.getElementById(id + '-tags');
    
    if (!display || !tagsContainer) return;
    
    const selected = multiSelectState[id] || [];
    
    if (selected.length === 0) {
        display.textContent = 'Select...';
        tagsContainer.innerHTML = '';
    } else {
        display.textContent = `${selected.length} selected`;
        
        let tagsHtml = '';
        selected.forEach(option => {
            tagsHtml += `
                <span class="tag">
                    ${option}
                    <button class="tag-close" onclick="removeMultiselectTag('${id}', '${escapeHtml(option)}')">×</button>
                </span>
            `;
        });
        tagsContainer.innerHTML = tagsHtml;
    }
}

function removeMultiselectTag(id, option) {
    const index = multiSelectState[id].indexOf(option);
    if (index > -1) {
        multiSelectState[id].splice(index, 1);
    }
    
    const checkbox = document.getElementById(`${id}-${option}`);
    if (checkbox) {
        checkbox.checked = false;
    }
    
    updateMultiselectDisplay(id);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Close multiselect when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.multiselect-container')) {
        document.querySelectorAll('.multiselect-dropdown').forEach(d => {
            d.classList.remove('active');
        });
    }
});

// ==========================================
// MODAL OPERATIONS
// ==========================================
function openModal(table, record) {
    currentTable = table;
    editingRecord = record;
    
    const title = record ? `Edit ${formatColumnName(table)}` : `Add ${formatColumnName(table)}`;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = '';
    
    const fields = getFormFields(table, record);
    document.getElementById('form-fields').innerHTML = fields;
    
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
    editingRecord = null;
}

function getFormFields(table, record) {
    let html = '';
    
    const fieldConfigs = {
        attendance: [
            { name: 'roll_number', label: 'Roll Number', type: 'text', required: true },
            { name: 'present', label: 'Status', type: 'select', options: 'attendance_status', required: true },
            { name: 'timestamp', label: 'Timestamp', type: 'datetime-local', required: true },
            { name: 'session_id', label: 'Session', type: 'select', options: 'sessions', required: true }
        ],
        attendance_sessions: [
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'session_id', label: 'Session', type: 'select', options: 'sessions', required: true },
            { name: 'trainer_id', label: 'Trainer', type: 'select', options: 'trainers', required: true },
            //{ name: 'vendor', label: 'Vendor', type: 'select', options: 'vendors', required: true },
            { name: 'day_order', label: 'Day Order', type: 'text', required: true },
            { name: 'topic_id', label: 'Topic', type: 'select', options: 'topics', required: false },
            { name: 'department_id', label: 'Department', type: 'select', options: 'departments', required: true },
            { name: 'duration', label: 'Duration (hours)', type: 'number', step: '0.01', min: '0', required: true } 
        ],
        students: [
            { name: 'roll_number', label: 'Roll Number', type: 'text', readonly: !!record, required: true },
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'department_id', label: 'Department', type: 'select', options: 'departments', required: true },
            { name: 'active', label: 'Status', type: 'select', options: 'active_status', required: true }
        ],
        trainers: [
            { name: 'trainer_id', label: 'Trainer ID', type: 'text', readonly: !!record, required: true },
            { name: 'mail_id', label: 'Email', type: 'email', required: true },
            { name: 'name', label: 'Name', type: 'text', required: false },
            { name: 'vendor', label: 'Vendor', type: 'text', required: true }
        ],
        topics: [
            { name: 'topic_name', label: 'Topic Name', type: 'text', required: true },
            { name: 'year', label: 'Year', type: 'number', required: false }
        ],
        departments: [
            { name: 'name', label: 'Department Name', type: 'text', required: true },
            { name: 'year', label: 'Year', type: 'number', required: false }
        ],
        day_order: [
            { name: 'vendor', label: 'Vendor', type: 'text', required: true },
            { name: 'day_order', label: 'Day Order', type: 'number', required: true },
            { name: 'department_id', label: 'Department', type: 'select', options: 'departments', required: true }
        ],
        sessions: [
            { name: 'session', label: 'Session', type: 'text', required: true }
        ]
    };
    
    const fields = fieldConfigs[table] || [];
    
    fields.forEach(field => {
        const value = record ? (record[field.name] || '') : '';
        
        if (field.type === 'checkbox') {
            const checked = record ? (record[field.name] ? 'checked' : '') : '';
            html += `<div class="form-group">
                <label><input type="checkbox" name="${field.name}" ${checked}> ${field.label}</label>
            </div>`;
        } else if (field.type === 'select' && field.options) {
            const requiredAttr = field.required ? 'required' : '';
            html += `<div class="form-group">
                <label>${field.label}${field.required ? ' *' : ''}</label>
                <select name="${field.name}" ${requiredAttr}>
                    <option value="">Select ${field.label}</option>
                    ${getSelectOptions(field.options, value)}
                </select>
            </div>`;
       } else {
        const requiredAttr = field.required ? 'required' : '';
        const readonlyAttr = field.readonly ? 'readonly' : '';
        const stepAttr = field.step ? `step="${field.step}"` : '';
        const minAttr = field.min ? `min="${field.min}"` : '';
        html += `<div class="form-group">
            <label>${field.label}${field.required ? ' *' : ''}</label>
            <input type="${field.type}" name="${field.name}" value="${value}" ${readonlyAttr} ${requiredAttr} ${stepAttr} ${minAttr}>
        </div>`;
    }
    });
    
    return html;
}

function getSelectOptions(type, selectedValue) {
    let options = '';

    if (type === 'attendance_status') {
        options += `<option value="P" ${selectedValue === 'P' ? 'selected' : ''}>Present (P)</option>`;
        options += `<option value="A" ${selectedValue === 'A' ? 'selected' : ''}>Absent (A)</option>`;
        options += `<option value="P:A" ${selectedValue === 'P:A' ? 'selected' : ''}>Present then Absent (P:A)</option>`;
        options += `<option value="A:P" ${selectedValue === 'A:P' ? 'selected' : ''}>Absent then Present (A:P)</option>`;
        return options;
    }

    if (type === 'active_status') {
        options += `<option value="true" ${selectedValue === true || selectedValue === 'true' ? 'selected' : ''}>Active</option>`;
        options += `<option value="false" ${selectedValue === false || selectedValue === 'false' ? 'selected' : ''}>Inactive</option>`;
        return options;
    }
    
    if (type === 'sessions') {

        sessions.forEach(s => {
            const selected = s.id == selectedValue ? 'selected' : '';
            options += `<option value="${s.id}" ${selected}>${s.session}</option>`;
        });
    } else if (type === 'departments') {
        departments.forEach(d => {
            const selected = d.id == selectedValue ? 'selected' : '';
            options += `<option value="${d.id}" ${selected}>${d.name}</option>`;
        });
    } else if (type === 'topics') {
        topics.forEach(t => {
            const selected = t.id == selectedValue ? 'selected' : '';
            options += `<option value="${t.id}" ${selected}>${t.topic_name}</option>`;
        });
    } else if (type === 'trainers') {
        trainers.forEach(t => {
            const selected = t.trainer_id == selectedValue ? 'selected' : '';
            options += `<option value="${t.trainer_id}" ${selected}>${t.name || t.trainer_id}</option>`;
        });
    } else if (type === 'vendors') {
        const uniqueVendors = [...new Set(trainers.map(t => t.vendor))].filter(Boolean).sort();
        uniqueVendors.forEach(vendor => {
            const selected = vendor == selectedValue ? 'selected' : '';
            options += `<option value="${vendor}" ${selected}>${vendor}</option>`;
        });
    }
    
    return options;
}

async function handleSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(document.getElementById('modal-form'));
    const data = {};
    
    // Get all form fields
    for (let [key, value] of formData.entries()) {
        // Just use the value as-is for all fields
        data[key] = value;
    }
    
    // Handle checkboxes that are unchecked
    const checkboxes = document.querySelectorAll('#modal-form input[type="checkbox"]');
    checkboxes.forEach(cb => {
        data[cb.name] = cb.checked;
    });
    
    try {
        let result;
        
        if (editingRecord) {
            // Update existing record
            const idField = getIdField(currentTable);
            const id = editingRecord[idField];
            
            result = await supabaseClient.from(currentTable).update(data).eq(idField, id);
            
            if (!result.error) {
                await logEdit(currentTable, id, 'UPDATE', editingRecord, data);
            }
        } else {
            // Insert new record
            result = await supabaseClient.from(currentTable).insert(data).select();
            
            if (!result.error && result.data && result.data[0]) {
                const idField = getIdField(currentTable);
                const newId = result.data[0][idField];
                await logEdit(currentTable, newId, 'INSERT', null, data);
            }
        }
        
        if (result.error) throw result.error;
        
        showMessage(currentTable, 'Saved successfully!', 'success');
        closeModal();
        await loadReferenceData();
        
        // Reload data then reapply filters
        await loadData(currentTable);
        applyFilters(currentTable);
    } catch (error) {
        document.getElementById('modal-message').innerHTML = 
            `<div class="message error">Error: ${error.message}</div>`;
    }
}

function getIdField(table) {
    if (table === 'students') return 'roll_number';
    if (table === 'trainers') return 'trainer_id';
    return 'id';
}

function editRecord(record, table) {
    currentTable = table;
    openModal(table, record);
}

async function deleteRecord(table, id) {
    if (!confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
        return;
    }
    
    try {
        const idField = getIdField(table);
        
        // Get old data for logging
        const { data: oldData } = await supabaseClient.from(table).select('*').eq(idField, id).single();
        
        const result = await supabaseClient.from(table).delete().eq(idField, id);
        if (result.error) throw result.error;
        
        await logEdit(table, id, 'DELETE', oldData, null);
        
        showMessage(table, 'Deleted successfully!', 'success');
        loadData(table);
    } catch (error) {
        showMessage(table, 'Error deleting record: ' + error.message, 'error');
    }
}

// ==========================================
// EDIT LOGGING
// ==========================================
async function logEdit(table, id, action, oldData, newData) {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const email = session?.user?.email || 'unknown';
        
        // Get trainer_id from email
        const { data: trainer } = await supabaseClient
            .from('trainers')
            .select('trainer_id')
            .eq('mail_id', email)
            .single();
        
        if (!trainer) {
            console.error('Trainer not found for email:', email);
            return;
        }
        
        await supabaseClient.from('edit_log').insert({
            table_name: table,
            record_id: String(id),
            action: action,
            old_data: oldData,
            new_data: newData,
            edited_by: String(trainer.trainer_id),
            edited_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('Log error:', error);
    }
}

async function loadAllFilteredData(table) {
    try {
        let query = supabaseClient.from(table)
            .select(table === 'attendance' ? 
                `*, attendance_sessions(date, session_id, department_id), students(name, department_id)` : 
                '*')
            .order(orderBy, { ascending: true })
            .range(offset, offset + batchSize - 1);
        
        // Apply same filters as current view
        if (table === 'attendance') {
            const filters = buildAttendanceFilters();
            query = applyAttendanceFiltersToQuery(query, filters);
        } else if (table === 'attendance_sessions') {
            const filters = buildSessionsFilters();
            query = applySessionsFiltersToQuery(query, filters);
        } else if (table === 'students') {
            const filters = buildStudentsFilters();
            query = applyStudentsFiltersToQuery(query, filters);
        } else if (table === 'trainers') {
            const filters = buildTrainersFilters();
            query = applyTrainersFiltersToQuery(query, filters);
        } else if (table === 'topics') {
            const filters = buildTopicsFilters();
            query = applyTopicsFiltersToQuery(query, filters);
        } else if (table === 'day_order') {
            const filters = buildDayOrderFilters();
            query = applyDayOrderFiltersToQuery(query, filters);
        }
        
        // Load ALL data (no pagination)
        let orderBy = 'id';
        if (table === 'trainers') {
            orderBy = 'trainer_id';
        } else if (table === 'students') {
            orderBy = 'roll_number';
        }
        const { data, error } = await query
            .select(table === 'attendance' ? `*, attendance_sessions(date, session_id, department_id)` : '*')
            .order(orderBy, { ascending: true });
        
        if (error) throw error;
        
        // Enrich data same as before
        if (table === 'attendance') {
            return data.map(record => {
                const student = studentMap[record.roll_number] || {};
                const dept = student.department_id ? departmentMap[student.department_id] : {};
                const session = record.attendance_sessions?.session_id ? sessionMap[record.attendance_sessions.session_id] : {};
                return {
                    ...record,
                    student_name: student.name || 'Unknown',
                    department_name: dept.name || 'Unknown',
                    date: record.attendance_sessions?.date || '',
                    session_name: session.session || 'Unknown'
                };
            });
        } else if (table === 'attendance_sessions') {
            return data.map(record => {
                const dept = record.department_id ? departmentMap[record.department_id] : {};
                const trainer = trainerMap[record.trainer_id] || {};
                const topic = record.topic_id ? topicMap[record.topic_id] : {};
                const session = sessionMap[record.session_id] || {};
                return {
                    ...record,
                    department_name: dept.name || '',
                     trainer_name: trainer.name || trainer.trainer_id || '',  // ← CHANGED: Fallback to trainer_id
                    trainer_id_key: record.trainer_id,  // ← ADD THIS: Keep original trainer_id for filtering
                    vendor: trainer.vendor || '',
                    topic_name: topic.topic_name || '',
                    session_name: session.session || ''
                };
            });
        } else if (table === 'students') {
            return data.map(student => {
                const dept = student.department_id ? departmentMap[student.department_id] : {};
                return { ...student, department_name: dept.name || '' };
            });
        } else if (table === 'day_order') {
            return data.map(record => {
                const dept = record.department_id ? departmentMap[record.department_id] : {};
                return { ...record, department_name: dept.name || '' };
            });
        }
        
        return data;
        
    } catch (error) {
        console.error('Error loading all data:', error);
        return [];
    }
}




// ==========================================
// DOWNLOAD CSV
// ==========================================

async function downloadTableData(table) {
    showMessage(table, 'Preparing download...', 'info');
    
    try {
        // Check if we have cached full data
        if (!fullDataCache[table]) {
            showMessage(table, 'Loading all filtered data...', 'info');
            
            // Get filters
            let filters;
            if (table === 'attendance') {
                filters = buildAttendanceFilters();
            } else if (table === 'attendance_sessions') {
                filters = buildSessionsFilters();
            } else if (table === 'students') {
                filters = buildStudentsFilters();
            } else if (table === 'trainers') {
                filters = buildTrainersFilters();
            } else if (table === 'topics') {
                filters = buildTopicsFilters();
            } else if (table === 'departments') {
                filters = buildDepartmentsFilters();
            } else if (table === 'day_order') {
                filters = buildDayOrderFilters();
            }
            
            // Load ALL data in batches (Supabase limit is 1000 per request)
            const batchSize = 1000;
            let allData = [];
            let offset = 0;
            let hasMore = true;
            
            const orderBy = table === 'trainers' ? 'trainer_id' : table === 'students' ? 'roll_number' : 'id';
            
            while (hasMore) {
                // FIXED: Build select query with students join for attendance
                let selectQuery = '*';
                if (table === 'attendance') {
                    selectQuery = `*, attendance_sessions(date, session_id, department_id), students(name, department_id)`;
                }
                
                // Build fresh query for each batch
                let query = supabaseClient.from(table)
                    .select(selectQuery)
                    .order(orderBy, { ascending: true })
                    .range(offset, offset + batchSize - 1);

                // *** SPECIAL HANDLING FOR ATTENDANCE ***
                if (table === 'attendance' && (filters.dateFrom || filters.dateTo)) {
                    // Get matching session IDs based on date filter
                    let sessionQuery = supabaseClient
                        .from('attendance_sessions')
                        .select('id');
                    
                    if (filters.dateFrom) sessionQuery = sessionQuery.gte('date', filters.dateFrom);
                    if (filters.dateTo) sessionQuery = sessionQuery.lte('date', filters.dateTo);
                    
                    const { data: matchingSessions } = await sessionQuery;
                    const sessionIds = matchingSessions.map(s => s.id);
                    
                    // Apply session_id filter
                    if (sessionIds.length > 0) {
                        query = query.in('session_id', sessionIds);
                    }
                    
                    // Apply other attendance filters
                    if (filters.roll) query = query.ilike('roll_number', `%${filters.roll}%`);
                    if (filters.present !== '') query = query.eq('present', filters.present);
                } else {
                    // Apply database-level filters for other tables
                    query = applyDatabaseFilters(query, filters, table);
                }
                
                // Fetch batch
                const { data, error } = await query;
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allData = allData.concat(data);
                    offset += batchSize;
                    
                    // Show progress
                    showMessage(table, `Loading... ${allData.length} records`, 'info');
                    
                    // If we got fewer records than batch size, we've reached the end
                    if (data.length < batchSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            }
            
            // Enrich and filter ALL data
            let enrichedData = await enrichData(table, allData);
            let filteredResults = applyClientFilters(table, enrichedData);
            
            // Cache it
            fullDataCache[table] = filteredResults;
        }
        
        const allFilteredData = fullDataCache[table];
        
        if (allFilteredData.length === 0) {
            showMessage(table, 'No data to download', 'error');
            return;
        }
        
        // Generate CSV from ALL filtered data
        let columns = getColumnsForTable(table);
        let csv = columns.map(col => formatColumnName(col)).join(',') + '\n';
        
        allFilteredData.forEach(row => {
            const values = columns.map(col => {
                let value = row[col];
                if (value === null || value === undefined) value = '';
                if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
                value = String(value);
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csv += values.join(',') + '\n';
        });
        
        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `${table}_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showMessage(table, `Downloaded ${allFilteredData.length} records!`, 'success');
        
    } catch (error) {
        showMessage(table, 'Error downloading: ' + error.message, 'error');
        console.error('Download error:', error);
    }
}



function getColumnsForTable(table) {
    if (table === 'attendance') return ['roll_number', 'student_name', 'department_name', 'date', 'session_name', 'present'];
    if (table === 'attendance_sessions') return ['id', 'department_name', 'trainer_name', 'topic_name', 'date', 'session_name', 'vendor','duration'];
    if (table === 'students') return ['roll_number', 'name', 'department_name', 'active'];
    if (table === 'trainers') return ['trainer_id', 'name', 'mail_id', 'vendor'];
    if (table === 'topics') return ['id', 'topic_name', 'year'];
    if (table === 'departments') return ['id', 'name', 'year'];
    if (table === 'day_order') return ['id', 'vendor', 'day_order', 'department_name'];
    if (table === 'sessions') return ['id', 'session'];
    return [];
}



// ==========================================
// MESSAGES
// ==========================================
function showMessage(table, msg, type) {
    const el = document.getElementById(table + '-message');
    if (!el) return;
    
    el.innerHTML = `<div class="message ${type}">${msg}</div>`;
    setTimeout(() => el.innerHTML = '', 5000);
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
    // Close modal when clicking outside
    document.getElementById('modal').addEventListener('click', function(e) {
        if (e.target.id === 'modal') {
            closeModal();
        }
    });
    
    // Apply filters on Enter key
    document.querySelectorAll('input[type="text"], input[type="date"]').forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                applyFilters(currentTable);
            }
        });
    });
}

function editAttendanceRecord(record) {
    currentTable = 'attendance';
    editingRecord = record;
    
    document.getElementById('modal-title').textContent = 'Edit Attendance Status';
    document.getElementById('modal-message').innerHTML = '';
    
    // Only show present/absent toggle
    const html = `
        <div class="form-group">
            <label>Student: ${record.student_name} (${record.roll_number})</label>
        </div>
        <div class="form-group">
            <label>Department: ${record.department_name}</label>
        </div>
        <div class="form-group">
            <label>Date: ${record.date}</label>
        </div>
        <div class="form-group">
            <label>Session: ${record.session_name}</label>
        </div>
        <div class="form-group">
            <label>Status *</label>
            <select name="present" required>
                <option value="P" ${record.present === 'P' ? 'selected' : ''}>Present (P)</option>
                <option value="A" ${record.present === 'A' ? 'selected' : ''}>Absent (A)</option>
                <option value="P:A" ${record.present === 'P:A' ? 'selected' : ''}>Present then Absent (P:A)</option>
                <option value="A:P" ${record.present === 'A:P' ? 'selected' : ''}>Absent then Present (A:P)</option>
            </select>
        </div>
    `;
    
    document.getElementById('form-fields').innerHTML = html;
    document.getElementById('modal').classList.add('active');
}

// ==========================================
// STATE PERSISTENCE
// ==========================================
function saveState() {
    const state = {
        currentTable: currentTable,
        currentPage: currentPage,
        multiSelectState: multiSelectState,
        dataLoaded: dataLoaded,
        // *** REMOVED: filteredData - this causes quota exceeded ***
        // *** REMOVED: totalRecords - will recalculate on load ***
        totalRecords: totalRecords,  // Keep this - it's just numbers
        filterInputs: {}
    };
    
    // Save all text, date, and select inputs
    document.querySelectorAll('input[type="text"], input[type="date"], select').forEach(input => {
        if (input.id && input.id.startsWith('filter-')) {
            state.filterInputs[input.id] = input.value;
        }
    });
    
    localStorage.setItem('adminDashboardState', JSON.stringify(state));
}

function loadState() {
    const savedState = localStorage.getItem('adminDashboardState');
    if (!savedState) return false;
    
    try {
        const state = JSON.parse(savedState);
        
        if (state.currentTable) {
            currentTable = state.currentTable;
        }
        
        if (state.currentPage) {
            currentPage = state.currentPage;
        }
        
        if (state.multiSelectState) {
            multiSelectState = state.multiSelectState;
        }
        
        if (state.dataLoaded) {
            dataLoaded = state.dataLoaded;
        }
        
        if (state.totalRecords) {
            totalRecords = state.totalRecords;
        }
        
        // Restore filter inputs
        if (state.filterInputs) {
            Object.keys(state.filterInputs).forEach(inputId => {
                const input = document.getElementById(inputId);
                if (input) {
                    input.value = state.filterInputs[inputId];
                }
            });
        }
        
        // *** KEY CHANGE: Return false if we don't have data ***
        // This forces a fresh data load with the saved filters
        return false;  // Changed from: return true
        
    } catch (error) {
        console.error('Error loading state:', error);
        return false;
    }
}

function clearState() {
    localStorage.removeItem('adminDashboardState');
}


// ==========================================
// MAKE FUNCTIONS GLOBALLY ACCESSIBLE
// ==========================================
window.applyFilters = applyFilters;
window.setDateRange = setDateRange;
window.switchTab = switchTab;
window.toggleFilters = toggleFilters;
window.clearFilters = clearFilters;
window.downloadTableData = downloadTableData;
window.editRecord = editRecord;
window.editAttendanceRecord = editAttendanceRecord;
window.changePage = changePage;
window.logout = logout;
window.closeModal = closeModal;
window.handleSubmit = handleSubmit;
window.openModal = openModal;
window.toggleMultiselect = toggleMultiselect;
window.selectAllMulti = selectAllMulti;
window.clearAllMulti = clearAllMulti;
window.handleMultiselectChange = handleMultiselectChange;
window.removeMultiselectTag = removeMultiselectTag;

// ==========================================
// INITIALIZE ON PAGE LOAD
// ==========================================
document.addEventListener('DOMContentLoaded', init);
