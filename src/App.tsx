import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { initializeApp } from 'firebase/app'
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  User as FirebaseUser
} from 'firebase/auth'
import {
  getFirestore, collection, doc, addDoc, updateDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs
} from 'firebase/firestore'
import { getStorage, ref as sRef, uploadString, getDownloadURL } from 'firebase/storage'

const FB = initializeApp({
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
})
const auth    = getAuth(FB)
const db      = getFirestore(FB)
const storage = getStorage(FB)
const gProv   = new GoogleAuthProvider()

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Role   = 'citizen' | 'volunteer' | 'coordinator'
type Level  = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type Status = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED'
type Page = 'dashboard' | 'report' | 'cases' | 'map' | 'volunteers' |
            'case_detail' | 'alerts' | 'profile' | 'analytics'

interface AppUser {
  uid: string; email: string; name: string; role: Role
  available?: boolean; skills?: string[]; rating?: number; casesHandled?: number; phone?: string
}
interface EmCase {
  id: string; reporterId: string; reporterName: string; description: string
  imageUrl?: string; lat: number; lng: number; address: string
  level: Level; emType: string; confidence: number; action: string
  status: Status; assignedTo?: string; assignedName?: string
  createdAt: Date; shortCircuited?: boolean; visionLabels?: string[]
  notifiedVolunteers?: string[]
}
interface Note { id: string; author: string; text: string; createdAt: Date }
interface Alert { id: string; title: string; body: string; level: Level; caseId?: string; createdAt: Date; read: boolean }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getName = (u: Partial<AppUser> & { displayName?: string }) =>
  u.name || (u as any).displayName || u.email?.split('@')[0] || 'User'

function toDate(v: any): Date {
  if (!v) return new Date()
  if (v instanceof Date) return v
  if (typeof v?.toDate === 'function') return v.toDate()
  return new Date(v)
}
function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`
}
function classifyText(t: string): Level {
  const s = t.toLowerCase()
  if (/fire|blast|explo|collaps|dead|critical|life.threat|severe/.test(s)) return 'CRITICAL'
  if (/accident|injur|attack|unconscious|bleed|fracture/.test(s)) return 'HIGH'
  if (/sick|hurt|help|emergency|flood|danger/.test(s)) return 'MEDIUM'
  return 'LOW'
}
function guessType(t: string): string {
  const s = t.toLowerCase()
  if (/fire|burn|flame/.test(s)) return 'FIRE'
  if (/accident|crash|vehicle|car|truck/.test(s)) return 'ACCIDENT'
  if (/medical|heart|chest|breath|unconscious|sick/.test(s)) return 'MEDICAL'
  if (/flood|water|drown/.test(s)) return 'FLOOD'
  if (/violence|attack|assault/.test(s)) return 'VIOLENCE'
  return 'OTHER'
}

const LEVEL_COLOR: Record<Level,string> = { CRITICAL:'#dc2626', HIGH:'#ea580c', MEDIUM:'#d97706', LOW:'#16a34a' }
const LEVEL_BG:    Record<Level,string> = { CRITICAL:'#fef2f2', HIGH:'#fff7ed', MEDIUM:'#fffbeb', LOW:'#f0fdf4' }
const LEVEL_GRAD:  Record<Level,string> = {
  CRITICAL:'linear-gradient(135deg,#ff416c,#ff4b2b)',
  HIGH:    'linear-gradient(135deg,#f7971e,#ffd200)',
  MEDIUM:  'linear-gradient(135deg,#4facfe,#00f2fe)',
  LOW:     'linear-gradient(135deg,#43e97b,#38f9d7)',
}
const STATUS_COLOR: Record<Status,string> = { PENDING:'#d97706', ASSIGNED:'#2563eb', IN_PROGRESS:'#7c3aed', RESOLVED:'#16a34a' }
const STATUS_BG:    Record<Status,string> = { PENDING:'#fffbeb', ASSIGNED:'#eff6ff', IN_PROGRESS:'#f5f3ff', RESOLVED:'#f0fdf4' }
const CRIT_LABELS = ['accident','fire','explosion','injury','blood','crash','smoke','ambulance','disaster']

const NAV_ITEMS: { page: Page; icon: string; label: string; roles: Role[] }[] = [
  { page: 'dashboard',  icon: '📊', label: 'Dashboard',        roles: ['citizen', 'volunteer', 'coordinator'] },
  { page: 'report',     icon: '🆘', label: 'Report Emergency', roles: ['citizen', 'volunteer', 'coordinator'] },
  { page: 'cases',      icon: '📋', label: 'All Cases',        roles: ['volunteer', 'coordinator'] },
  { page: 'analytics',  icon: '📈', label: 'Analytics',        roles: ['coordinator'] },
  { page: 'map',        icon: '🗺️', label: 'Resource Map',     roles: ['volunteer', 'coordinator'] },
  { page: 'volunteers', icon: '👥', label: 'Volunteers',        roles: ['coordinator'] },
  { page: 'alerts',     icon: '🔔', label: 'Alerts',           roles: ['citizen', 'volunteer', 'coordinator'] },
  { page: 'profile',    icon: '👤', label: 'My Profile',       roles: ['citizen', 'volunteer', 'coordinator'] },
]

// ─── LANGUAGE / i18n ──────────────────────────────────────────────────────────
type Lang = 'en' | 'hi'
const translations = {
  en: {
    // Nav
    nav_dashboard:   'Dashboard',
    nav_report:      'Report Emergency',
    nav_cases:       'All Cases',
    nav_analytics:   'Analytics',
    nav_map:         'Resource Map',
    nav_volunteers:  'Volunteers',
    nav_alerts:      'Alerts',
    nav_profile:     'My Profile',
    nav_signout:     '🚪 Sign Out',
    nav_lang:        '🌐 Language',
    // App shell
    loading_sevak:   'Loading SEVAK...',
    setting_profile: 'Setting up profile...',
    critical_pending:'Critical Pending',
    // Topbar
    topbar_case:     'Case',
    // Login
    login_subtitle:  'AI-Powered Emergency Response Platform',
    login_signin:    'Sign In',
    login_register:  'Register',
    login_name:      'Full Name',
    login_name_ph:   'Your full name',
    login_role:      'Register as',
    login_role_c:    '🏠 Citizen / Reporter',
    login_role_v:    '🙋 Volunteer Responder',
    login_role_co:   '🎯 Coordinator / Admin',
    login_email:     'Email',
    login_pass:      'Password',
    login_btn_in:    'Sign In →',
    login_btn_up:    'Create Account →',
    login_or:        'or',
    login_google:    'Continue with Google',
    login_roles_note:'Roles: Citizen = report emergencies · Volunteer = respond to cases · Coordinator = manage everything',
    // Dashboard
    dash_title:      'Command Dashboard',
    dash_welcome:    'Welcome back',
    dash_seed:       '🌱 Load Demo Data',
    dash_seeding:    'Seeding...',
    dash_seeded:     '✅ Demo data loaded',
    dash_report_btn: '🆘 Report Emergency',
    dash_critical_banner: 'CRITICAL Emergency',
    dash_critical_plural: 'CRITICAL Emergencies',
    dash_critical_sub:   'Volunteers have been auto-notified. Please review and assign responders.',
    dash_view_cases: 'View Cases →',
    dash_my_cases:   '⚡ Your Assigned Cases',
    dash_stat_total: 'Total Cases',
    dash_stat_pending:'Pending',
    dash_stat_active:'Active Now',
    dash_stat_resolved:'Resolved',
    dash_feed_title: 'Live Emergency Feed',
    dash_feed_empty: 'All clear — no emergencies',
    dash_feed_sub:   'Cases appear here in real time',
    dash_feed_reporter:'Reporter',
    dash_feed_type:  'Type',
    dash_feed_level: 'Level',
    dash_feed_status:'Status',
    dash_feed_time:  'Time',
    dash_feed_view:  'View',
    dash_vol_status: '👥 Volunteer Status',
    dash_available:  'Available',
    dash_busy:       'Busy',
    dash_cases_handled:'cases handled',
    dash_manage_vols:'Manage Volunteers',
    dash_resp_stats: '📊 Response Stats',
    dash_avg_resp:   'Avg Response Time',
    dash_week_cases: 'Cases This Week',
    dash_unread:     'Unread Alerts',
    // Report
    rep_title:       '🆘 Report Emergency',
    rep_sub:         'Multimodal AI intake — text, image & voice. AI auto-dispatches volunteers.',
    rep_desc_label:  '💬 Describe the Emergency',
    rep_desc_hint:   '— as much detail as possible',
    rep_desc_ph:     'e.g. Major road accident on NH-4 near Wakad. Two trucks collided, multiple people trapped and injured. Need medical help urgently...',
    rep_img_label:   '📷 Scene Image',
    rep_img_hint:    '— Google Vision AI',
    rep_img_remove:  '✕ Remove',
    rep_img_vision:  '✓ Vision AI will analyze for emergency signals',
    rep_img_tap:     'Tap to upload or capture',
    rep_img_auto:    'Vision AI detects accidents, fire, injuries automatically',
    rep_voice_label: '🎙️ Voice Report',
    rep_voice_hint:  '— EN / HI / MR',
    rep_voice_ok:    'Voice captured successfully',
    rep_rerec:       'Re-record',
    rep_hold:        'Hold to record',
    rep_recording:   '🔴 Recording... release to stop',
    rep_voice_langs: 'Supports English, Hindi, Marathi',
    rep_pipeline:    '⚙️ AI Processing Pipeline',
    rep_running:     'Running...',
    rep_no_input:    'no input',
    rep_submit:      '🚨 Submit & Dispatch Emergency',
    rep_busy_btn:    'Analyzing & Dispatching...',
    rep_info:        'After submission, AI classifies severity and automatically notifies all available volunteers and coordinators. For CRITICAL/HIGH cases, the nearest available volunteer is auto-assigned.',
    rep_result_done: '✓ Submitted · AI Analysis Complete',
    rep_confidence:  '🎯 Confidence:',
    rep_vision_sc:   '⚡ Vision Short-Circuit',
    rep_auto_assign: '👤 Auto-assigned →',
    rep_notified:    '🔔 Volunteers & Coordinators Notified',
    rep_saved:       '✓ Saved to Database',
    // Cases
    cas_title:       'All Cases',
    cas_total:       'total',
    cas_pending_sub: 'pending',
    cas_search_ph:   '🔍  Search cases...',
    cas_filter_all:  'All',
    cas_no_match:    'No cases match your filter',
    cas_col_id:      'ID',
    cas_col_reporter:'Reporter',
    cas_col_type:    'Type',
    cas_col_level:   'Level',
    cas_col_status:  'Status',
    cas_col_assigned:'Assigned',
    cas_col_time:    'Time',
    cas_view:        'View →',
    // Case Detail
    cd_back:         '← Back to Cases',
    cd_loading:      'Loading case...',
    cd_you_vol:      'You are the responding volunteer',
    cd_status_lbl:   'Status:',
    cd_on_way:       "⚡ I'm On My Way",
    cd_mark_resolved:'✅ Mark as Resolved',
    cd_closing_note: '📝 Closing note (optional)',
    cd_closing_ph:   'e.g. Patient stabilised, transferred to hospital. Scene secured.',
    cd_confirm_res:  '✅ Confirm Resolved',
    cd_saving:       'Saving...',
    cd_cancel:       'Cancel',
    cd_resolved_banner:'Case Resolved — Great Work!',
    cd_case_info:    '📋 Case Information',
    cd_id:           'ID',
    cd_reporter:     'Reporter',
    cd_location:     'Location',
    cd_assigned_to:  'Assigned To',
    cd_reported:     'Reported',
    cd_resp_time:    'Response Time',
    cd_resolved_by:  'Resolved By',
    cd_unassigned:   'Unassigned',
    cd_description:  'Description',
    cd_vision_lbl:   'Vision Labels',
    cd_status_mgmt:  '⚡ Status Management',
    cd_force_resolve:'✅ Force Resolve',
    cd_reopen:       '🔄 Re-open Case',
    cd_assign_vol:   '👥 Assign Volunteer',
    cd_release:      'Release',
    cd_curr_assigned:'● Currently assigned',
    cd_active:       '✓ Active',
    cd_reassign:     'Re-assign to different volunteer:',
    cd_select_vol:   'Select a volunteer to assign:',
    cd_no_vols:      'No volunteers available right now',
    cd_cases:        'cases',
    cd_assign_arrow: 'Assign →',
    cd_ai_analysis:  '🎯 AI Analysis',
    cd_confidence:   'Confidence',
    cd_resp_time_lbl:'Response Time',
    cd_notes_title:  '📝 Team Notes',
    cd_no_notes:     'No notes yet',
    cd_note_ph:      'Add a note... (Enter to send)',
    cd_note_send:    'Send',
    cd_entries:      'entries',
    // Analytics
    an_title:        '📊 Analytics',
    an_sub:          'System-wide performance overview',
    an_total:        'Total Cases',
    an_resolved:     'Resolved',
    an_avg_resp:     'Avg Response',
    an_active_vols:  'Active Volunteers',
    an_trend:        '📈 Daily Case Trend (7d)',
    an_severity:     '🎯 Cases by Severity',
    an_types:        '🏷️ Emergency Types',
    an_leaderboard:  '🏆 Volunteer Leaderboard',
    an_no_data:      'No data for this period',
    an_no_vols:      'No volunteers yet',
    an_of_total:     'of',
    an_total2:       'total',
    an_rate:         'rate',
    an_last:         'last',
    an_days:         'days',
    // Profile
    pr_title:        '👤 My Profile',
    pr_sub:          'Manage your account details and preferences',
    pr_availability: 'AVAILABILITY',
    pr_go_unavail:   '🔴 Go Unavailable',
    pr_go_avail:     '🟢 Go Available',
    pr_available:    'Available',
    pr_unavailable:  'Unavailable',
    pr_edit:         '✏️ Edit Details',
    pr_fullname:     'Full Name',
    pr_fullname_ph:  'Your full name',
    pr_phone:        'Phone Number',
    pr_phone_ph:     '+91 XXXXX XXXXX',
    pr_skills:       'Skills',
    pr_skills_hint:  '(comma-separated)',
    pr_skills_ph:    'First Aid, CPR, Rescue...',
    pr_save:         '💾 Save Changes',
    pr_stats:        '📊 Your Stats',
    pr_cases_handled:'Cases Handled',
    pr_rating:       'Rating',
    pr_your_skills:  'Your Skills',
    pr_account:      '🛡️ Account Info',
    pr_role:         'Role',
    pr_userid:       'User ID',
    pr_email:        'Email',
    // Volunteers
    vl_title:        '👥 Volunteer Management',
    vl_available:    'available',
    vl_busy:         'busy',
    vl_total:        'total',
    vl_avail_now:    'Available Now',
    vl_busy_dep:     'Busy / Deployed',
    vl_total_done:   'Total Cases Done',
    vl_search_ph:    '🔍 Search volunteers...',
    vl_volunteers:   'volunteers',
    vl_no_vols:      'No volunteers registered',
    vl_no_vols_sub:  'Users who register as Volunteer appear here',
    vl_col_vol:      'Volunteer',
    vl_col_email:    'Email',
    vl_col_rating:   'Rating',
    vl_col_done:     'Cases Done',
    vl_col_status:   'Status',
    vl_col_action:   'Action',
    vl_mark_busy:    'Mark Busy',
    vl_mark_avail:   'Mark Available',
    vl_general:      'General responder',
    // Alerts
    al_title:        '🔔 Alerts & Notifications',
    al_unread:       'unread',
    al_total:        'total',
    al_mark_all:     'Mark all read',
    al_empty_title:  'No alerts yet',
    al_empty_sub:    "You'll be notified here when emergencies are reported or assigned to you",
    al_view_case:    'View Case →',
    // Map
    map_title:       '🗺️ Resource Map',
    map_cases:       'active cases',
    map_vols:        'volunteers available',
    map_no_key:      'Maps API key not configured',
    map_no_key_sub:  'Add VITE_GOOGLE_MAPS_API_KEY to .env.local',
    map_volunteer:   'Volunteer',
  },
  hi: {
    // Nav
    nav_dashboard:   'डैशबोर्ड',
    nav_report:      'आपातकाल रिपोर्ट करें',
    nav_cases:       'सभी केस',
    nav_analytics:   'विश्लेषण',
    nav_map:         'संसाधन मानचित्र',
    nav_volunteers:  'स्वयंसेवक',
    nav_alerts:      'सूचनाएँ',
    nav_profile:     'मेरी प्रोफ़ाइल',
    nav_signout:     '🚪 साइन आउट',
    nav_lang:        '🌐 भाषा',
    // App shell
    loading_sevak:   'SEVAK लोड हो रहा है...',
    setting_profile: 'प्रोफ़ाइल सेट हो रही है...',
    critical_pending:'गंभीर लंबित',
    // Topbar
    topbar_case:     'केस',
    // Login
    login_subtitle:  'AI-संचालित आपातकाल प्रतिक्रिया प्लेटफ़ॉर्म',
    login_signin:    'साइन इन',
    login_register:  'पंजीकरण',
    login_name:      'पूरा नाम',
    login_name_ph:   'आपका पूरा नाम',
    login_role:      'किस रूप में पंजीकृत हों',
    login_role_c:    '🏠 नागरिक / रिपोर्टर',
    login_role_v:    '🙋 स्वयंसेवक उत्तरदाता',
    login_role_co:   '🎯 समन्वयक / प्रशासक',
    login_email:     'ईमेल',
    login_pass:      'पासवर्ड',
    login_btn_in:    'साइन इन करें →',
    login_btn_up:    'खाता बनाएं →',
    login_or:        'या',
    login_google:    'Google से जारी रखें',
    login_roles_note:'भूमिकाएँ: नागरिक = आपातकाल रिपोर्ट करें · स्वयंसेवक = केस पर प्रतिक्रिया करें · समन्वयक = सब कुछ प्रबंधित करें',
    // Dashboard
    dash_title:      'कमांड डैशबोर्ड',
    dash_welcome:    'वापस स्वागत है',
    dash_seed:       '🌱 डेमो डेटा लोड करें',
    dash_seeding:    'लोड हो रहा है...',
    dash_seeded:     '✅ डेमो डेटा लोड हुआ',
    dash_report_btn: '🆘 आपातकाल रिपोर्ट करें',
    dash_critical_banner: 'गंभीर आपातकाल',
    dash_critical_plural: 'गंभीर आपातकाल',
    dash_critical_sub:   'स्वयंसेवकों को सूचित किया गया है। कृपया समीक्षा करें और उत्तरदाता नियुक्त करें।',
    dash_view_cases: 'केस देखें →',
    dash_my_cases:   '⚡ आपके असाइन किए गए केस',
    dash_stat_total: 'कुल केस',
    dash_stat_pending:'लंबित',
    dash_stat_active:'अभी सक्रिय',
    dash_stat_resolved:'हल किए गए',
    dash_feed_title: 'लाइव आपातकाल फ़ीड',
    dash_feed_empty: 'सब साफ़ — कोई आपातकाल नहीं',
    dash_feed_sub:   'केस यहाँ रीयल टाइम में दिखेंगे',
    dash_feed_reporter:'रिपोर्टर',
    dash_feed_type:  'प्रकार',
    dash_feed_level: 'स्तर',
    dash_feed_status:'स्थिति',
    dash_feed_time:  'समय',
    dash_feed_view:  'देखें',
    dash_vol_status: '👥 स्वयंसेवक स्थिति',
    dash_available:  'उपलब्ध',
    dash_busy:       'व्यस्त',
    dash_cases_handled:'केस संभाले',
    dash_manage_vols:'स्वयंसेवक प्रबंधित करें',
    dash_resp_stats: '📊 प्रतिक्रिया आँकड़े',
    dash_avg_resp:   'औसत प्रतिक्रिया समय',
    dash_week_cases: 'इस सप्ताह के केस',
    dash_unread:     'अपठित सूचनाएँ',
    // Report
    rep_title:       '🆘 आपातकाल रिपोर्ट करें',
    rep_sub:         'मल्टीमोडल AI — टेक्स्ट, चित्र और आवाज़। AI स्वयंसेवकों को स्वत: भेजता है।',
    rep_desc_label:  '💬 आपातकाल का वर्णन करें',
    rep_desc_hint:   '— जितना संभव हो उतना विवरण दें',
    rep_desc_ph:     'उदा. NH-4 पर वकड के पास बड़ा सड़क हादसा। दो ट्रक टकराए, कई लोग फंसे और घायल। तुरंत चिकित्सा सहायता चाहिए...',
    rep_img_label:   '📷 दृश्य चित्र',
    rep_img_hint:    '— Google Vision AI',
    rep_img_remove:  '✕ हटाएं',
    rep_img_vision:  '✓ Vision AI आपातकालीन संकेत खोजेगा',
    rep_img_tap:     'अपलोड करने के लिए टैप करें',
    rep_img_auto:    'Vision AI दुर्घटनाएं, आग, चोटें स्वत: पहचानता है',
    rep_voice_label: '🎙️ आवाज़ रिपोर्ट',
    rep_voice_hint:  '— EN / HI / MR',
    rep_voice_ok:    'आवाज़ सफलतापूर्वक रिकॉर्ड हुई',
    rep_rerec:       'दोबारा रिकॉर्ड करें',
    rep_hold:        'रिकॉर्ड करने के लिए दबाए रखें',
    rep_recording:   '🔴 रिकॉर्डिंग... रोकने के लिए छोड़ें',
    rep_voice_langs: 'अंग्रेज़ी, हिंदी, मराठी समर्थित',
    rep_pipeline:    '⚙️ AI प्रोसेसिंग पाइपलाइन',
    rep_running:     'चल रहा है...',
    rep_no_input:    'कोई इनपुट नहीं',
    rep_submit:      '🚨 सबमिट करें और भेजें',
    rep_busy_btn:    'विश्लेषण और भेज रहे हैं...',
    rep_info:        'सबमिट करने के बाद, AI गंभीरता वर्गीकृत करता है और सभी उपलब्ध स्वयंसेवकों व समन्वयकों को सूचित करता है।',
    rep_result_done: '✓ सबमिट हुआ · AI विश्लेषण पूर्ण',
    rep_confidence:  '🎯 विश्वास:',
    rep_vision_sc:   '⚡ Vision शॉर्ट-सर्किट',
    rep_auto_assign: '👤 स्वत: नियुक्त →',
    rep_notified:    '🔔 स्वयंसेवक और समन्वयक सूचित',
    rep_saved:       '✓ डेटाबेस में सहेजा गया',
    // Cases
    cas_title:       'सभी केस',
    cas_total:       'कुल',
    cas_pending_sub: 'लंबित',
    cas_search_ph:   '🔍  केस खोजें...',
    cas_filter_all:  'सभी',
    cas_no_match:    'आपके फ़िल्टर से कोई केस नहीं मिला',
    cas_col_id:      'ID',
    cas_col_reporter:'रिपोर्टर',
    cas_col_type:    'प्रकार',
    cas_col_level:   'स्तर',
    cas_col_status:  'स्थिति',
    cas_col_assigned:'नियुक्त',
    cas_col_time:    'समय',
    cas_view:        'देखें →',
    // Case Detail
    cd_back:         '← केस पर वापस जाएं',
    cd_loading:      'केस लोड हो रहा है...',
    cd_you_vol:      'आप उत्तरदाता स्वयंसेवक हैं',
    cd_status_lbl:   'स्थिति:',
    cd_on_way:       '⚡ मैं आ रहा हूँ',
    cd_mark_resolved:'✅ हल किया हुआ चिह्नित करें',
    cd_closing_note: '📝 समापन नोट (वैकल्पिक)',
    cd_closing_ph:   'उदा. मरीज़ स्थिर हुए, अस्पताल स्थानांतरित। दृश्य सुरक्षित।',
    cd_confirm_res:  '✅ हल की पुष्टि करें',
    cd_saving:       'सहेज रहे हैं...',
    cd_cancel:       'रद्द करें',
    cd_resolved_banner:'केस हल हुआ — शानदार काम!',
    cd_case_info:    '📋 केस जानकारी',
    cd_id:           'ID',
    cd_reporter:     'रिपोर्टर',
    cd_location:     'स्थान',
    cd_assigned_to:  'नियुक्त को',
    cd_reported:     'रिपोर्ट किया',
    cd_resp_time:    'प्रतिक्रिया समय',
    cd_resolved_by:  'हल करने वाले',
    cd_unassigned:   'अनियुक्त',
    cd_description:  'विवरण',
    cd_vision_lbl:   'Vision लेबल',
    cd_status_mgmt:  '⚡ स्थिति प्रबंधन',
    cd_force_resolve:'✅ जबरदस्ती हल करें',
    cd_reopen:       '🔄 केस पुनः खोलें',
    cd_assign_vol:   '👥 स्वयंसेवक नियुक्त करें',
    cd_release:      'छोड़ें',
    cd_curr_assigned:'● वर्तमान में नियुक्त',
    cd_active:       '✓ सक्रिय',
    cd_reassign:     'अलग स्वयंसेवक को पुनः नियुक्त करें:',
    cd_select_vol:   'नियुक्त करने के लिए स्वयंसेवक चुनें:',
    cd_no_vols:      'अभी कोई स्वयंसेवक उपलब्ध नहीं',
    cd_cases:        'केस',
    cd_assign_arrow: 'नियुक्त करें →',
    cd_ai_analysis:  '🎯 AI विश्लेषण',
    cd_confidence:   'विश्वास',
    cd_resp_time_lbl:'प्रतिक्रिया समय',
    cd_notes_title:  '📝 टीम नोट्स',
    cd_no_notes:     'अभी कोई नोट नहीं',
    cd_note_ph:      'नोट जोड़ें... (भेजने के लिए Enter)',
    cd_note_send:    'भेजें',
    cd_entries:      'प्रविष्टियाँ',
    // Analytics
    an_title:        '📊 विश्लेषण',
    an_sub:          'सिस्टम-व्यापी प्रदर्शन अवलोकन',
    an_total:        'कुल केस',
    an_resolved:     'हल किए गए',
    an_avg_resp:     'औसत प्रतिक्रिया',
    an_active_vols:  'सक्रिय स्वयंसेवक',
    an_trend:        '📈 दैनिक केस प्रवृत्ति (7d)',
    an_severity:     '🎯 गंभीरता के अनुसार केस',
    an_types:        '🏷️ आपातकाल के प्रकार',
    an_leaderboard:  '🏆 स्वयंसेवक लीडरबोर्ड',
    an_no_data:      'इस अवधि के लिए कोई डेटा नहीं',
    an_no_vols:      'अभी कोई स्वयंसेवक नहीं',
    an_of_total:     'में से',
    an_total2:       'कुल',
    an_rate:         'दर',
    an_last:         'पिछले',
    an_days:         'दिन',
    // Profile
    pr_title:        '👤 मेरी प्रोफ़ाइल',
    pr_sub:          'अपनी खाता जानकारी और प्राथमिकताएं प्रबंधित करें',
    pr_availability: 'उपलब्धता',
    pr_go_unavail:   '🔴 अनुपलब्ध हों',
    pr_go_avail:     '🟢 उपलब्ध हों',
    pr_available:    'उपलब्ध',
    pr_unavailable:  'अनुपलब्ध',
    pr_edit:         '✏️ विवरण संपादित करें',
    pr_fullname:     'पूरा नाम',
    pr_fullname_ph:  'आपका पूरा नाम',
    pr_phone:        'फ़ोन नंबर',
    pr_phone_ph:     '+91 XXXXX XXXXX',
    pr_skills:       'कौशल',
    pr_skills_hint:  '(अल्पविराम से अलग करें)',
    pr_skills_ph:    'प्राथमिक उपचार, CPR, बचाव...',
    pr_save:         '💾 परिवर्तन सहेजें',
    pr_stats:        '📊 आपके आँकड़े',
    pr_cases_handled:'संभाले गए केस',
    pr_rating:       'रेटिंग',
    pr_your_skills:  'आपके कौशल',
    pr_account:      '🛡️ खाता जानकारी',
    pr_role:         'भूमिका',
    pr_userid:       'उपयोगकर्ता ID',
    pr_email:        'ईमेल',
    // Volunteers
    vl_title:        '👥 स्वयंसेवक प्रबंधन',
    vl_available:    'उपलब्ध',
    vl_busy:         'व्यस्त',
    vl_total:        'कुल',
    vl_avail_now:    'अभी उपलब्ध',
    vl_busy_dep:     'व्यस्त / तैनात',
    vl_total_done:   'कुल केस पूर्ण',
    vl_search_ph:    '🔍 स्वयंसेवक खोजें...',
    vl_volunteers:   'स्वयंसेवक',
    vl_no_vols:      'कोई स्वयंसेवक पंजीकृत नहीं',
    vl_no_vols_sub:  'स्वयंसेवक के रूप में पंजीकृत उपयोगकर्ता यहाँ दिखेंगे',
    vl_col_vol:      'स्वयंसेवक',
    vl_col_email:    'ईमेल',
    vl_col_rating:   'रेटिंग',
    vl_col_done:     'केस पूर्ण',
    vl_col_status:   'स्थिति',
    vl_col_action:   'कार्रवाई',
    vl_mark_busy:    'व्यस्त चिह्नित करें',
    vl_mark_avail:   'उपलब्ध चिह्नित करें',
    vl_general:      'सामान्य उत्तरदाता',
    // Alerts
    al_title:        '🔔 सूचनाएँ और अधिसूचनाएँ',
    al_unread:       'अपठित',
    al_total:        'कुल',
    al_mark_all:     'सभी पढ़े हुए चिह्नित करें',
    al_empty_title:  'अभी कोई सूचना नहीं',
    al_empty_sub:    'जब आपातकाल रिपोर्ट किए जाएंगे या आपको सौंपे जाएंगे, तब यहाँ सूचित किया जाएगा',
    al_view_case:    'केस देखें →',
    // Map
    map_title:       '🗺️ संसाधन मानचित्र',
    map_cases:       'सक्रिय केस',
    map_vols:        'स्वयंसेवक उपलब्ध',
    map_no_key:      'Maps API कुंजी कॉन्फ़िगर नहीं',
    map_no_key_sub:  '.env.local में VITE_GOOGLE_MAPS_API_KEY जोड़ें',
    map_volunteer:   'स्वयंसेवक',
  },
}
type TKey = keyof typeof translations.en
const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: 'en', setLang: () => {}, t: (k) => translations.en[k],
})
const useLang = () => useContext(LangCtx)

function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en')
  const t = useCallback((k: TKey) => translations[lang][k] || translations.en[k], [lang])
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f0f4ff; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
  input, textarea, select, button { font-family: 'Plus Jakarta Sans', sans-serif; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important; }
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fadeUp  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  @keyframes toastIn { from{transform:translateX(24px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes ping    { 0%{transform:scale(1);opacity:1} 75%,100%{transform:scale(2);opacity:0} }
  .fade-up { animation: fadeUp 0.4s ease both; }
  .card-hover { transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; }
  .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(99,102,241,0.15) !important; }
  .nav-item { display:flex;align-items:center;gap:12px;padding:11px 20px;cursor:pointer;font-size:14px;font-weight:500;color:#64748b;border-left:3px solid transparent;transition:all 0.15s;border-radius:0 12px 12px 0;margin:2px 8px 2px 0; }
  .nav-item:hover { background:#f8faff; color:#6366f1; }
  .nav-item.active { background:linear-gradient(90deg,#ede9fe,#e0e7ff); color:#6366f1; font-weight:700; border-left:3px solid #6366f1; }
  .btn-primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border:none; padding:11px 22px; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.2s; }
  .btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 20px rgba(99,102,241,0.4); }
  .btn-primary:disabled { opacity:0.55; cursor:not-allowed; transform:none; }
  .btn-outline { background:#fff; color:#6366f1; border:1.5px solid #6366f1; padding:9px 18px; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s; }
  .btn-outline:hover { background:#f5f3ff; }
  .btn-danger { background:linear-gradient(135deg,#ff416c,#ff4b2b); color:#fff; border:none; padding:9px 18px; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; }
  .btn-success { background:linear-gradient(135deg,#43e97b,#38f9d7); color:#fff; border:none; padding:9px 18px; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; }
  .input { width:100%; box-sizing:border-box; border:1.5px solid #e2e8f0; border-radius:10px; padding:11px 14px; font-size:14px; color:#1e293b; background:#fafbfd; transition:border 0.2s; }
  .card { background:#fff; border-radius:18px; padding:24px; box-shadow:0 2px 16px rgba(99,102,241,0.07); border:1px solid #ede9fe; }
  .tag { display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { padding:12px 16px; text-align:left; font-weight:700; color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #f0f4ff; }
  td { padding:14px 16px; border-bottom:1px solid #f8fafc; color:#334155; vertical-align:middle; }
  tr:hover td { background:#fafbff; }
`

// Inject CSS immediately at module load — fixes LoginPage inputs
// (LoginPage renders before AppShell which previously held the <style> tag)
;(function injectCSS() {
  if (typeof document === 'undefined') return
  if (document.getElementById('sevak-css')) return
  const s = document.createElement('style')
  s.id = 'sevak-css'
  s.textContent = css
  document.head.appendChild(s)
})()

// ─── TOAST ────────────────────────────────────────────────────────────────────
const ToastCtx = createContext<(msg:string,type?:'success'|'error'|'info'|'warning')=>void>(()=>{})
const useToast = () => useContext(ToastCtx)

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{id:number;msg:string;type:string}[]>([])
  const show = useCallback((msg:string, type='info') => {
    const id = Date.now()
    setToasts(t=>[...t,{id,msg,type}])
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 4000)
  },[])
  const cfg: Record<string,{color:string;icon:string;bg:string}> = {
    success:{color:'#16a34a',icon:'✓',bg:'#f0fdf4'},
    error:  {color:'#dc2626',icon:'✕',bg:'#fef2f2'},
    warning:{color:'#d97706',icon:'⚠',bg:'#fffbeb'},
    info:   {color:'#2563eb',icon:'ℹ',bg:'#eff6ff'},
  }
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div style={{position:'fixed',bottom:24,right:24,zIndex:9999,display:'flex',flexDirection:'column',gap:10}}>
        {toasts.map(t=>{
          const c = cfg[t.type]||cfg.info
          return (
            <div key={t.id} style={{background:c.bg,border:`1.5px solid ${c.color}`,borderLeft:`4px solid ${c.color}`,color:'#1e293b',padding:'13px 18px',borderRadius:14,fontSize:14,fontWeight:500,boxShadow:'0 8px 30px rgba(0,0,0,0.1)',maxWidth:360,display:'flex',alignItems:'center',gap:10,animation:'toastIn 0.3s ease'}}>
              <span style={{color:c.color,fontWeight:700,fontSize:16}}>{c.icon}</span>
              {t.msg}
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
const AuthCtx = createContext<{firebaseUser:FirebaseUser|null;profile:AppUser|null;loading:boolean;refreshProfile:()=>Promise<void>}>({firebaseUser:null,profile:null,loading:true,refreshProfile:async()=>{}})
const useAuth = () => useContext(AuthCtx)

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFbUser] = useState<FirebaseUser|null>(null)
  const [profile, setProfile]     = useState<AppUser|null>(null)
  const [loading, setLoading]     = useState(true)

  async function loadProfile(u: FirebaseUser) {
    // Retry up to 5 times with delay — handles race condition where
    // Firestore doc isn't written yet when onAuthStateChanged fires
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const snap = await getDoc(doc(db, 'users', u.uid))
        if (snap.exists()) {
          const d = snap.data()
          const resolvedName = d.name || d.displayName || u.displayName || u.email?.split('@')[0] || 'User'
          // Explicitly read role — never default to citizen if the doc exists
          const resolvedRole = (d.role as Role) || 'citizen'
          setProfile({
            uid: u.uid,
            email: d.email || u.email || '',
            name: resolvedName,
            role: resolvedRole,
            available: d.available ?? false,
            skills: d.skills || [],
            rating: d.rating || 5,
            casesHandled: d.casesHandled || 0,
            phone: d.phone || ''
          })
          return // success — stop retrying
        }
        // Doc doesn't exist yet — wait and retry
        await new Promise(r => setTimeout(r, 600))
      } catch {
        await new Promise(r => setTimeout(r, 600))
      }
    }
    // After all retries, fall back to minimal profile
    setProfile({ uid: u.uid, email: u.email || '', name: u.displayName || u.email?.split('@')[0] || 'User', role: 'citizen' })
  }

  const refreshProfile = async () => { if (firebaseUser) await loadProfile(firebaseUser) }

  useEffect(()=>onAuthStateChanged(auth, async u=>{
    setFbUser(u)
    if (u) await loadProfile(u); else setProfile(null)
    setLoading(false)
  }),[])

  return <AuthCtx.Provider value={{firebaseUser,profile,loading,refreshProfile}}>{children}</AuthCtx.Provider>
}

// ─── AI PIPELINE ──────────────────────────────────────────────────────────────
async function visionAnalyze(b64:string) {
  const key = import.meta.env.VITE_GOOGLE_VISION_API_KEY
  if (!key) return {labels:[],ocr:'',critical:false}
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{image:{content:b64},features:[{type:'LABEL_DETECTION',maxResults:10},{type:'TEXT_DETECTION'}]}]})})
    const d = await r.json()
    const labels = (d.responses?.[0]?.labelAnnotations||[]).filter((l:any)=>l.score>0.65).map((l:any)=>l.description.toLowerCase())
    const ocr    = d.responses?.[0]?.textAnnotations?.[0]?.description||''
    return {labels,ocr,critical:labels.some((l:string)=>CRIT_LABELS.some(c=>l.includes(c)))}
  } catch { return {labels:[],ocr:'',critical:false} }
}

async function speechToText(b64:string): Promise<string> {
  const key = import.meta.env.VITE_GOOGLE_SPEECH_API_KEY
  if (!key) return ''
  try {
    const r = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{encoding:'WEBM_OPUS',sampleRateHertz:48000,languageCode:'en-IN',alternativeLanguageCodes:['hi-IN','mr-IN']},audio:{content:b64}})})
    const d = await r.json()
    return d.results?.map((r:any)=>r.alternatives?.[0]?.transcript).join(' ')||''
  } catch { return '' }
}

async function groqAnalyze(text:string,labels:string[],address:string) {
  const key = import.meta.env.VITE_GROQ_API_KEY
  const fallback = {level:classifyText(text) as Level,emType:guessType(text),confidence:0.65,action:'Dispatch nearest available responder immediately. Monitor situation closely.'}
  if (!key) return fallback
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:200,temperature:0.1,response_format:{type:'json_object'},messages:[{role:'system',content:'Emergency triage AI. Respond ONLY with JSON: {"level":"CRITICAL|HIGH|MEDIUM|LOW","emType":"MEDICAL|ACCIDENT|FIRE|FLOOD|VIOLENCE|OTHER","confidence":0.95,"action":"one sentence dispatch instruction"}'},{role:'user',content:`Report: "${text}" | Scene labels: ${labels.join(',')||'none'} | Location: ${address}`}]})})
    const d = await r.json()
    const p = JSON.parse(d.choices?.[0]?.message?.content||'{}')
    return {level:(p.level||'MEDIUM') as Level,emType:p.emType||'OTHER',confidence:p.confidence||0.7,action:p.action||fallback.action}
  } catch { return fallback }
}

async function runPipeline(text:string,imgB64:string|null,audioB64:string|null,address:string,onStep:(s:string)=>void) {
  let labels:string[]=[], shortCircuited=false, transcript=''
  const tasks:Promise<void>[]=[]
  if (imgB64)   { onStep('vision'); tasks.push(visionAnalyze(imgB64).then(r=>{labels=r.labels;shortCircuited=r.critical}).catch(()=>{})) }
  if (audioB64) { onStep('speech'); tasks.push(speechToText(audioB64).then(t=>{transcript=t}).catch(()=>{})) }
  await Promise.allSettled(tasks)
  const fullText=[text,transcript?`[Voice] ${transcript}`:''].filter(Boolean).join(' ')
  if (shortCircuited) {
    const lbl=labels.find(l=>CRIT_LABELS.some(c=>l.includes(c)))||'emergency'
    return {level:'HIGH' as Level,emType:lbl.includes('fire')?'FIRE':'ACCIDENT',confidence:0.95,action:'Critical scene confirmed by Vision AI. Dispatching emergency response immediately.',shortCircuited:true,visionLabels:labels}
  }
  onStep('groq')
  const result = await groqAnalyze(fullText||'Emergency reported',labels,address)
  return {...result,shortCircuited:false,visionLabels:labels}
}

// ─── DISPATCH ENGINE — auto-notify volunteers after report ────────────────────
async function dispatchCase(caseId:string, level:Level, emType:string, address:string, reporterName:string) {
  try {
    // Find available volunteers
    const volSnap = await getDocs(query(collection(db,'users'), where('role','==','volunteer')))
    const availableVols = volSnap.docs.filter(d => d.data().available === true)
    const coords  = await getDocs(query(collection(db,'users'), where('role','==','coordinator')))
    const notified: string[] = []

    // Create in-app alerts for all volunteers + coordinators
    const targets = [...volSnap.docs, ...coords.docs]
    for (const userDoc of targets) {
      const uid = userDoc.id
      notified.push(uid)
      await addDoc(collection(db,'alerts'), {
        userId:    uid,
        title:     `${level} Emergency — ${emType}`,
        body:      `New case reported by ${reporterName} at ${address}. Immediate response required.`,
        level,
        caseId,
        read:      false,
        createdAt: serverTimestamp(),
      })
    }

    // Auto-assign nearest volunteer if CRITICAL or HIGH
    if (['CRITICAL','HIGH'].includes(level) && availableVols.length > 0) {
      const vol      = availableVols[0]
      const volData  = vol.data()
      const volName  = volData.name || volData.displayName || 'Volunteer'
      await updateDoc(doc(db,'cases',caseId), {
        assignedTo:   vol.id,
        assignedName: volName,
        status:       'ASSIGNED',
      })
      // Mark volunteer busy
      await updateDoc(doc(db,'users',vol.id), { available: false })
      // Notify volunteer specifically
      await addDoc(collection(db,'alerts'), {
        userId:    vol.id,
        title:     '🚨 You have been assigned a case!',
        body:      `${level} ${emType} at ${address}. You are the responding volunteer.`,
        level,
        caseId,
        read:      false,
        createdAt: serverTimestamp(),
      })
      return { assignedName: volName, assignedId: vol.id }
    }
    return { assignedName: null, assignedId: null }
  } catch(e) {
    console.error('Dispatch error:', e)
    return { assignedName: null, assignedId: null }
  }
}


// ─── DEMO SEED DATA ───────────────────────────────────────────────────────────
async function seedDemoData(): Promise<{ok:boolean; msg:string}> {
  try {
    const sentinel = await getDoc(doc(db,'_meta','seeded'))
    if (sentinel.exists()) return { ok:false, msg:'Demo data already seeded.' }
    const now = Date.now(); const DAY = 86_400_000
    // Seed demo volunteer user docs (no Firebase Auth account — just Firestore profiles)
    const demoVols = [
      { name:'Arjun Patil',    email:'arjun@demo.in', role:'volunteer' as Role, available:true,  skills:['First Aid','CPR'],  rating:4.8, casesHandled:12 },
      { name:'Priya Sharma',   email:'priya@demo.in', role:'volunteer' as Role, available:true,  skills:['Medical'],          rating:4.9, casesHandled:18 },
      { name:'Rohan Desai',    email:'rohan@demo.in', role:'volunteer' as Role, available:false, skills:['Fire Safety'],      rating:4.6, casesHandled:9  },
      { name:'Sneha Kulkarni', email:'sneha@demo.in', role:'volunteer' as Role, available:true,  skills:['Rescue','Search'],  rating:5.0, casesHandled:22 },
    ]
    const volIds: string[] = []
    for (const v of demoVols) {
      const ref = await addDoc(collection(db,'users'), { ...v, phone:'', casesHandled:v.casesHandled, createdAt:serverTimestamp() })
      volIds.push(ref.id)
    }
    // Historical resolved cases for analytics
    const hist = [
      { desc:'Multi-vehicle accident on Pune-Mumbai Expressway. 3 vehicles, 2 injured.',          level:'HIGH'     as Level, type:'ACCIDENT', d:6, min:9,  vol:0 },
      { desc:'Kitchen fire in residential building, Kothrud. Spreading to adjacent units.',       level:'CRITICAL' as Level, type:'FIRE',     d:5, min:7,  vol:2 },
      { desc:'Elderly man collapsed at Laxmi Road market. Suspected cardiac arrest.',             level:'CRITICAL' as Level, type:'MEDICAL',  d:4, min:6,  vol:1 },
      { desc:'Flash flooding near Mutha River, Mundhwa. 5 families stranded.',                   level:'HIGH'     as Level, type:'FLOOD',    d:4, min:22, vol:3 },
      { desc:'Road accident near Wakad signal. Bike vs auto. Rider unconscious.',                 level:'HIGH'     as Level, type:'ACCIDENT', d:3, min:11, vol:0 },
      { desc:'Gas cylinder leak in shop, Deccan Gymkhana. Risk of explosion.',                   level:'CRITICAL' as Level, type:'FIRE',     d:2, min:8,  vol:2 },
      { desc:'Child with high fever and difficulty breathing, Aundh. Parents requesting urgent help.', level:'HIGH' as Level, type:'MEDICAL', d:1, min:14, vol:1 },
    ]
    for (const c of hist) {
      const createdMs  = now - c.d * DAY
      const resolvedMs = createdMs + c.min * 60_000
      await addDoc(collection(db,'cases'), {
        reporterId:'demo_seed', reporterName:'SEVAK Demo',
        description:c.desc, lat:18.5204+(Math.random()-0.5)*0.08, lng:73.8567+(Math.random()-0.5)*0.08,
        address:'Pune, Maharashtra', level:c.level, emType:c.type, confidence:0.91,
        action:`Resolved. ${demoVols[c.vol].name} handled on-site.`,
        status:'RESOLVED' as Status,
        assignedTo:volIds[c.vol], assignedName:demoVols[c.vol].name,
        resolvedByName:demoVols[c.vol].name, responseTimeMinutes:c.min,
        createdAt:new Date(createdMs), resolvedAt:new Date(resolvedMs),
        shortCircuited:false, visionLabels:[],
      })
    }
    // 2 live demo cases
    const live1 = await addDoc(collection(db,'cases'),{
      reporterId:'demo_seed', reporterName:'Rahul Joshi',
      description:'Accident on Baner Road near Balewadi Stadium. SUV hit two-wheeler. One person trapped under vehicle, unresponsive.',
      lat:18.5590, lng:73.7868, address:'Baner Road, Balewadi Stadium, Pune',
      level:'CRITICAL' as Level, emType:'ACCIDENT', confidence:0.94,
      action:'Critical injury. Dispatch ambulance and rescue team immediately.',
      status:'ASSIGNED' as Status, assignedTo:volIds[0], assignedName:demoVols[0].name,
      createdAt:new Date(now - 12*60_000), shortCircuited:false, visionLabels:['accident','vehicle','road'],
    })
    await updateDoc(doc(db,'users',volIds[0]),{ available:false })
    await addDoc(collection(db,'cases',live1.id,'notes'),{ author:'System', text:'Case auto-dispatched. Arjun Patil notified and confirmed en route.', createdAt:new Date(now-10*60_000) })

    const live2 = await addDoc(collection(db,'cases'),{
      reporterId:'demo_seed', reporterName:'Meera Nair',
      description:'Elderly woman has fallen down stairs at her home in Aundh. Conscious but unable to move. Possible hip fracture.',
      lat:18.5590, lng:73.8072, address:'Aundh, Near ITI Road, Pune',
      level:'HIGH' as Level, emType:'MEDICAL', confidence:0.87,
      action:'Send medical volunteer. Possible fracture — do not move patient without support.',
      status:'PENDING' as Status, createdAt:new Date(now - 4*60_000), shortCircuited:false, visionLabels:[],
    })
    await addDoc(collection(db,'cases',live2.id,'notes'),{ author:'System', text:'No volunteers assigned yet. Awaiting coordinator action.', createdAt:new Date(now-3*60_000) })

    // Alerts for any real coordinators
    const coordSnap = await getDocs(query(collection(db,'users'),where('role','==','coordinator')))
    for (const coord of coordSnap.docs) {
      await addDoc(collection(db,'alerts'),{ userId:coord.id, title:'🚨 CRITICAL Accident — Baner Road', body:'Arjun Patil auto-assigned. Review for backup.', level:'CRITICAL' as Level, caseId:live1.id, read:false, createdAt:serverTimestamp() })
      await addDoc(collection(db,'alerts'),{ userId:coord.id, title:'⚠️ HIGH Medical — Aundh (Unassigned)', body:'Elderly fall. No volunteer yet. Needs action.', level:'HIGH' as Level, caseId:live2.id, read:false, createdAt:serverTimestamp() })
    }
    await setDoc(doc(db,'_meta','seeded'),{ at:serverTimestamp(), v:1 })
    return { ok:true, msg:'Demo data loaded! 7 resolved cases + 2 live cases + 4 volunteers.' }
  } catch(e:any) { return { ok:false, msg: e?.message||'Seed failed — check Firestore rules.' } }
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
function Spinner({ size=20, color='#6366f1' }: { size?:number; color?:string }) {
  return <div style={{width:size,height:size,border:`2.5px solid #e2e8f0`,borderTop:`2.5px solid ${color}`,borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}} />
}

function Avatar({ name, size=36 }: { name?:string; size?:number }) {
  const n = (name||'?').toString()
  const colors = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899']
  const c = colors[(n.charCodeAt(0)||0)%colors.length]
  return <div style={{width:size,height:size,borderRadius:'50%',background:c,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:size*0.38,flexShrink:0}}>{n[0]?.toUpperCase()||'?'}</div>
}

function LevelBadge({ level }: { level:Level }) {
  return <span className="tag" style={{background:LEVEL_BG[level],color:LEVEL_COLOR[level]}}>{level}</span>
}
function StatusBadge({ status }: { status:Status }) {
  return <span className="tag" style={{background:STATUS_BG[status],color:STATUS_COLOR[status]}}>{status.replace('_',' ')}</span>
}

function StatCard({ label, value, grad, icon, sub }: { label:string; value:number|string; grad:string; icon:string; sub?:string }) {
  return (
    <div style={{borderRadius:18,padding:24,background:grad,color:'#fff',position:'relative',overflow:'hidden',minHeight:120}} className="card-hover fade-up">
      <div style={{position:'absolute',right:-10,top:-10,fontSize:72,opacity:0.12}}>{icon}</div>
      <div style={{fontSize:38,fontWeight:800,letterSpacing:'-1px'}}>{value}</div>
      <div style={{fontSize:13,opacity:0.9,fontWeight:500,marginTop:4}}>{label}</div>
      {sub && <div style={{marginTop:10,background:'rgba(255,255,255,0.22)',borderRadius:20,padding:'3px 12px',fontSize:12,display:'inline-block'}}>{sub}</div>}
    </div>
  )
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginPage() {
  const toast = useToast()
  const {refreshProfile} = useAuth()
  const { t } = useLang()
  const [mode, setMode]   = useState<'login'|'signup'>('login')
  const [email, setEmail] = useState('')
  const [pass, setPass]   = useState('')
  const [name, setName]   = useState('')
  const [role, setRole]   = useState<Role>('citizen')
  const [busy, setBusy]   = useState(false)

  async function handleEmail() {
    if (!email||!pass) { toast('Fill in all fields','error'); return }
    if (mode==='signup'&&!name) { toast('Enter your name','error'); return }
    setBusy(true)
    try {
      if (mode==='login') {
        await signInWithEmailAndPassword(auth,email,pass)
        toast('Welcome back!','success')
      } else {
        const c = await createUserWithEmailAndPassword(auth, email, pass)
        const profileData = {
          email,
          name,
          role,  // save exactly what the user selected
          available: role === 'volunteer',
          skills: [],
          rating: 5,
          casesHandled: 0,
        }
        await setDoc(doc(db, 'users', c.user.uid), profileData)
        // Wait for Firestore to confirm write before loading profile
        await new Promise(r => setTimeout(r, 800))
        await refreshProfile()
        toast('Account created!','success')
      }
    } catch(e:any) {
      const m = e.message||''
      if (m.includes('email-already-in-use')) toast('Email already registered','error')
      else if (m.includes('wrong-password')||m.includes('invalid-credential')) toast('Wrong email or password','error')
      else if (m.includes('weak-password')) toast('Password needs 6+ characters','error')
      else toast(m.replace('Firebase: ','').split('(')[0]||'Failed','error')
    }
    setBusy(false)
  }

  async function handleGoogle() {
    setBusy(true)
    try {
      const res = await signInWithPopup(auth,gProv)
      const u   = res.user
      const sn  = await getDoc(doc(db,'users',u.uid))
      if (!sn.exists()) await setDoc(doc(db,'users',u.uid),{email:u.email||'',name:u.displayName||'User',role:'citizen',available:false,skills:[],rating:5,casesHandled:0})
      await refreshProfile()
      toast('Signed in!','success')
    } catch(e:any) { toast(e.message?.split('(')[0]||'Google sign-in failed','error') }
    setBusy(false)
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#667eea 0%,#764ba2 50%,#f093fb 100%)',display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:'Plus Jakarta Sans'}}>
      <div style={{position:'fixed',top:-120,right:-120,width:500,height:500,borderRadius:'50%',background:'rgba(255,255,255,0.06)',pointerEvents:'none'}}/>
      <div style={{position:'fixed',bottom:-80,left:-80,width:400,height:400,borderRadius:'50%',background:'rgba(255,255,255,0.08)',pointerEvents:'none'}}/>

      <div style={{background:'#fff',borderRadius:28,padding:44,width:'100%',maxWidth:460,boxShadow:'0 30px 80px rgba(0,0,0,0.2)',boxSizing:'border-box'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{width:72,height:72,borderRadius:20,background:'linear-gradient(135deg,#ff416c,#ff4b2b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,margin:'0 auto 16px',boxShadow:'0 8px 24px rgba(255,65,108,0.4)'}}>🚨</div>
          <div style={{fontSize:30,fontWeight:800,color:'#1e293b',letterSpacing:'-0.5px'}}>SEVAK</div>
          <div style={{fontSize:14,color:'#94a3b8',marginTop:6}}>{t('login_subtitle')}</div>
        </div>

        <div style={{display:'flex',background:'#f4f6fb',borderRadius:12,padding:4,marginBottom:24}}>
          {(['login','signup'] as const).map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:'10px',border:'none',borderRadius:9,fontFamily:'Plus Jakarta Sans',fontSize:14,fontWeight:600,cursor:'pointer',background:mode===m?'#fff':'transparent',color:mode===m?'#6366f1':'#64748b',boxShadow:mode===m?'0 2px 8px rgba(0,0,0,0.1)':'none',transition:'all 0.2s'}}>
              {m==='login'?t('login_signin'):t('login_register')}
            </button>
          ))}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14,width:'100%'}}>
          {mode==='signup' && <>
            <div><label style={{fontSize:13,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>{t('login_name')}</label><input className="input" placeholder={t('login_name_ph')} value={name} onChange={e=>setName(e.target.value)}/></div>
            <div><label style={{fontSize:13,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>{t('login_role')}</label>
              <select className="input" value={role} onChange={e=>setRole(e.target.value as Role)}>
                <option value="citizen">{t('login_role_c')}</option>
                <option value="volunteer">{t('login_role_v')}</option>
                <option value="coordinator">{t('login_role_co')}</option>
              </select>
            </div>
          </>}
          <div><label style={{fontSize:13,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>{t('login_email')}</label><input className="input" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleEmail()}/></div>
          <div><label style={{fontSize:13,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>{t('login_pass')}</label><input className="input" type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleEmail()}/></div>
        </div>

        <button className="btn-primary" onClick={handleEmail} disabled={busy} style={{width:'100%',justifyContent:'center',marginTop:20,padding:14,fontSize:15,borderRadius:14}}>
          {busy?<Spinner size={18} color="#fff"/>:mode==='login'?t('login_btn_in'):t('login_btn_up')}
        </button>

        <div style={{display:'flex',alignItems:'center',gap:12,margin:'18px 0'}}><div style={{flex:1,height:1,background:'#e2e8f0'}}/><span style={{fontSize:12,color:'#94a3b8'}}>{t('login_or')}</span><div style={{flex:1,height:1,background:'#e2e8f0'}}/></div>

        <button onClick={handleGoogle} disabled={busy} style={{width:'100%',padding:13,border:'1.5px solid #e2e8f0',borderRadius:14,background:'#fff',fontFamily:'Plus Jakarta Sans',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,color:'#334155',transition:'all 0.2s'}}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          {t('login_google')}
        </button>

        <div style={{marginTop:20,padding:14,background:'#f8fafc',borderRadius:12,fontSize:12,color:'#64748b',lineHeight:1.6}}>
          {t('login_roles_note')}
        </div>
      </div>
    </div>
  )
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardPage({ cases, user, onNavigate, unreadAlerts }: { cases:EmCase[]; user:AppUser; onNavigate:(p:Page,id?:string)=>void; unreadAlerts:number }) {
  const toast = useToast()
  const { t } = useLang()
  const [volunteers, setVolunteers] = useState<AppUser[]>([])
  const [seeding, setSeeding]       = useState(false)
  const [seedDone, setSeedDone]     = useState(false)

  async function handleSeed() {
    setSeeding(true)
    const r = await seedDemoData()
    setSeeding(false)
    if (r.ok) { setSeedDone(true); toast(r.msg,'success') }
    else toast(r.msg, r.msg.includes('already')?'info':'error')
  }

  useEffect(()=>{
    return onSnapshot(query(collection(db,'users'),where('role','==','volunteer')), snap=>{
      setVolunteers(snap.docs.map(d=>({uid:d.id,...d.data()} as AppUser)))
    })
  },[])

  const stats = {
    total:    cases.length,
    pending:  cases.filter(c=>c.status==='PENDING').length,
    active:   cases.filter(c=>c.status==='ASSIGNED'||c.status==='IN_PROGRESS').length,
    resolved: cases.filter(c=>c.status==='RESOLVED').length,
    critical: cases.filter(c=>c.level==='CRITICAL').length,
    availVols: volunteers.filter(v=>v.available).length,
  }

  const myAssigned = user.role==='volunteer' ? cases.filter(c=>c.assignedTo===user.uid&&c.status!=='RESOLVED') : []

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{marginBottom:28,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:26,fontWeight:800,color:'#1e293b',letterSpacing:'-0.5px'}}>{t('dash_title')}</div>
          <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>
            {t('dash_welcome')}, <strong style={{color:'#6366f1'}}>{getName(user).split(' ')[0]}</strong> · {new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}
          </div>
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',flexShrink:0}}>
          {user.role==='coordinator' && !seedDone && (
            <button onClick={handleSeed} disabled={seeding} style={{padding:'10px 18px',border:'1.5px solid #c7d2fe',borderRadius:10,background:'#fff',color:'#6366f1',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:7,opacity:seeding?0.6:1,transition:'all 0.15s'}}>
              {seeding ? <><Spinner size={14}/> {t('dash_seeding')}</> : t('dash_seed')}
            </button>
          )}
          {user.role==='coordinator' && seedDone && (
            <div style={{padding:'10px 16px',background:'#f0fdf4',border:'1.5px solid #bbf7d0',borderRadius:10,fontSize:13,fontWeight:700,color:'#15803d',display:'flex',alignItems:'center',gap:6}}>{t('dash_seeded')}</div>
          )}
          <button className="btn-primary" onClick={()=>onNavigate('report')}>
            {t('dash_report_btn')}
          </button>
        </div>
      </div>

      {/* Critical banner */}
      {stats.critical > 0 && (
        <div style={{background:'linear-gradient(135deg,#dc2626,#ff416c)',borderRadius:16,padding:'16px 24px',marginBottom:24,display:'flex',alignItems:'center',gap:16,color:'#fff',boxShadow:'0 8px 24px rgba(220,38,38,0.35)',animation:'fadeUp 0.3s ease'}} className="card-hover">
          <div style={{width:44,height:44,borderRadius:12,background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>🔴</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:16}}>{stats.critical} {stats.critical>1?t('dash_critical_plural'):t('dash_critical_banner')} Require Immediate Response</div>
            <div style={{opacity:0.85,fontSize:13,marginTop:2}}>{t('dash_critical_sub')}</div>
          </div>
          <button onClick={()=>onNavigate('cases')} style={{background:'rgba(255,255,255,0.25)',border:'none',color:'#fff',padding:'9px 20px',borderRadius:10,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontWeight:700,fontSize:13,flexShrink:0}}>{t('dash_view_cases')}</button>
        </div>
      )}

      {/* My assigned cases — for volunteers */}
      {user.role==='volunteer' && myAssigned.length>0 && (
        <div className="card fade-up" style={{marginBottom:24,borderLeft:'4px solid #6366f1'}}>
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:14}}>{t('dash_my_cases')}</div>
          {myAssigned.map(c=>(
            <div key={c.id} onClick={()=>onNavigate('case_detail',c.id)} className="card-hover" style={{display:'flex',alignItems:'center',gap:14,padding:'12px 14px',border:'1.5px solid #ede9fe',borderRadius:12,marginBottom:8,cursor:'pointer',background:'#faf9ff'}}>
              <div style={{width:42,height:42,borderRadius:12,background:LEVEL_BG[c.level],display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>
                {c.emType==='FIRE'?'🔥':c.emType==='MEDICAL'?'🏥':c.emType==='ACCIDENT'?'🚗':'🆘'}
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,color:'#1e293b'}}>{c.emType} — <LevelBadge level={c.level}/></div>
                <div style={{fontSize:13,color:'#64748b',marginTop:3}}>{c.description?.slice(0,70)}...</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <StatusBadge status={c.status}/>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{timeAgo(c.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:18,marginBottom:28}}>
        <StatCard label={t('dash_stat_total')}    value={stats.total}    grad="linear-gradient(135deg,#6366f1,#8b5cf6)" icon="📋"/>
        <StatCard label={t('dash_stat_pending')}   value={stats.pending}  grad="linear-gradient(135deg,#f59e0b,#f97316)" icon="⏳" sub={stats.pending>0?`${stats.pending} need attention`:''}/>
        <StatCard label={t('dash_stat_active')}    value={stats.active}   grad="linear-gradient(135deg,#3b82f6,#06b6d4)" icon="⚡"/>
        <StatCard label={t('dash_stat_resolved')}  value={stats.resolved} grad="linear-gradient(135deg,#10b981,#34d399)" icon="✅"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:20}}>
        {/* Live feed */}
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
            <div style={{fontSize:16,fontWeight:700,color:'#1e293b'}}>{t('dash_feed_title')}</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{position:'relative',display:'inline-block',width:10,height:10}}>
                <span style={{position:'absolute',inset:0,borderRadius:'50%',background:'#ef4444',animation:'ping 1.5s infinite'}}/>
                <span style={{position:'absolute',inset:0,borderRadius:'50%',background:'#ef4444'}}/>
              </span>
              <span style={{fontSize:12,color:'#ef4444',fontWeight:700}}>LIVE</span>
            </div>
          </div>
          {cases.length===0 ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'#94a3b8'}}>
              <div style={{fontSize:48,marginBottom:12}}>🛡️</div>
              <div style={{fontWeight:600,fontSize:16}}>{t('dash_feed_empty')}</div>
              <div style={{fontSize:13,marginTop:6}}>{t('dash_feed_sub')}</div>
            </div>
          ) : (
            <table>
              <thead><tr><th>{t('dash_feed_reporter')}</th><th>{t('dash_feed_type')}</th><th>{t('dash_feed_level')}</th><th>{t('dash_feed_status')}</th><th>{t('dash_feed_time')}</th><th></th></tr></thead>
              <tbody>
                {cases.slice(0,8).map(c=>(
                  <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>onNavigate('case_detail',c.id)}>
                    <td><div style={{display:'flex',alignItems:'center',gap:8}}><Avatar name={c.reporterName} size={28}/><span style={{fontWeight:600}}>{c.reporterName}</span></div></td>
                    <td><span style={{background:'#f0f4ff',padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:600,color:'#6366f1'}}>{c.emType}</span></td>
                    <td><LevelBadge level={c.level}/></td>
                    <td><StatusBadge status={c.status}/></td>
                    <td style={{fontSize:12,color:'#94a3b8',whiteSpace:'nowrap'}}>{timeAgo(c.createdAt)}</td>
                    <td><button className="btn-outline" onClick={e=>{e.stopPropagation();onNavigate('case_detail',c.id)}} style={{padding:'6px 14px',fontSize:12}}>{t('dash_feed_view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Side panel */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Volunteer status */}
          <div className="card">
            <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:14}}>{t('dash_vol_status')}</div>
            <div style={{display:'flex',gap:12,marginBottom:14}}>
              <div style={{flex:1,background:'#f0fdf4',borderRadius:12,padding:'12px',textAlign:'center'}}>
                <div style={{fontSize:24,fontWeight:800,color:'#16a34a'}}>{stats.availVols}</div>
                <div style={{fontSize:12,color:'#16a34a',fontWeight:600}}>{t('dash_available')}</div>
              </div>
              <div style={{flex:1,background:'#fff7ed',borderRadius:12,padding:'12px',textAlign:'center'}}>
                <div style={{fontSize:24,fontWeight:800,color:'#ea580c'}}>{volunteers.length-stats.availVols}</div>
                <div style={{fontSize:12,color:'#ea580c',fontWeight:600}}>{t('dash_busy')}</div>
              </div>
            </div>
            {volunteers.slice(0,4).map(v=>(
              <div key={v.uid} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid #f0f4ff'}}>
                <Avatar name={getName(v)} size={32}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#334155'}}>{getName(v)}</div>
                  <div style={{fontSize:11,color:'#94a3b8'}}>{v.casesHandled||0} {t('dash_cases_handled')}</div>
                </div>
                <div style={{width:8,height:8,borderRadius:'50%',background:v.available?'#16a34a':'#ea580c'}}/>
              </div>
            ))}
            {user.role==='coordinator' && <button className="btn-outline" onClick={()=>onNavigate('volunteers')} style={{width:'100%',marginTop:12,textAlign:'center'}}>{t('dash_manage_vols')}</button>}
          </div>

          {/* Quick stats */}
          <div className="card" style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',border:'none'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:14}}>{t('dash_resp_stats')}</div>
            {[
              {label:t('dash_avg_resp'), value:'4.2 min'},
              {label:t('dash_week_cases'), value:cases.filter(c=>Date.now()-c.createdAt.getTime()<7*86400000).length},
              {label:t('dash_unread'),    value:unreadAlerts},
            ].map(s=>(
              <div key={s.label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.15)',fontSize:13}}>
                <span style={{opacity:0.85}}>{s.label}</span>
                <strong>{s.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── REPORT PAGE ──────────────────────────────────────────────────────────────
function ReportPage({ user }: { user:AppUser }) {
  const toast = useToast()
  const { t } = useLang()
  const [text, setText]         = useState('')
  const [imgB64, setImgB64]     = useState<string|null>(null)
  const [imgPrev, setImgPrev]   = useState<string|null>(null)
  const [audioB64, setAudio]    = useState<string|null>(null)
  const [recoding, setRec]      = useState(false)
  const [busy, setBusy]         = useState(false)
  const [step, setStep]         = useState('')
  const [result, setResult]     = useState<any>(null)
  const mediaRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<Blob[]>([])

  function handleImg(e:React.ChangeEvent<HTMLInputElement>) {
    const f=e.target.files?.[0]; if(!f) return
    const r=new FileReader(); r.onload=ev=>{const s=ev.target?.result as string;setImgPrev(s);setImgB64(s.split(',')[1]);toast('Image loaded — Vision AI will analyze it','success')}; r.readAsDataURL(f)
  }

  async function startRec() {
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      const mr=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'})
      chunksRef.current=[]; mr.ondataavailable=e=>chunksRef.current.push(e.data)
      mr.onstop=()=>{const blob=new Blob(chunksRef.current,{type:'audio/webm'});const r=new FileReader();r.onload=ev=>{setAudio((ev.target?.result as string).split(',')[1]);toast('Voice captured!','success')};r.readAsDataURL(blob);stream.getTracks().forEach(t=>t.stop())}
      mr.start(); mediaRef.current=mr; setRec(true)
    } catch { toast('Microphone access denied','error') }
  }
  function stopRec() { mediaRef.current?.stop(); setRec(false) }

  async function handleSubmit() {
    if (!text&&!imgB64&&!audioB64) { toast('Provide at least one input','error'); return }
    setBusy(true); setResult(null); setStep('')
    try {
      let lat=18.5204, lng=73.8567, address='Location unavailable'
      try { const p=await new Promise<GeolocationPosition>((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:5000})); lat=p.coords.latitude; lng=p.coords.longitude; address=`${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E` } catch {}

      const ai = await runPipeline(text,imgB64,audioB64,address,setStep)

      // Upload image
      let imageUrl=''
      if (imgB64) { try { const ref=sRef(storage,`cases/img_${Date.now()}.jpg`); await uploadString(ref,imgB64,'base64',{contentType:'image/jpeg'}); imageUrl=await getDownloadURL(ref) } catch {} }

      // Save case
      const caseRef = await addDoc(collection(db,'cases'),{
        reporterId:user.uid, reporterName:getName(user),
        description:text||'Reported via image/voice',
        imageUrl, lat, lng, address,
        level:ai.level, emType:ai.emType, confidence:ai.confidence,
        action:ai.action, shortCircuited:ai.shortCircuited, visionLabels:ai.visionLabels||[],
        status:'PENDING', createdAt:serverTimestamp(),
      })

      // DISPATCH — notify volunteers & auto-assign if critical
      setStep('dispatch')
      const dispatch = await dispatchCase(caseRef.id, ai.level, ai.emType, address, getName(user))

      setResult({...ai, dispatch, caseId:caseRef.id})
      setText(''); setImgB64(null); setImgPrev(null); setAudio(null)

      if (dispatch.assignedName) toast(`✓ Auto-assigned to volunteer ${dispatch.assignedName}!`,'success')
      else toast('Emergency reported! Volunteers & coordinators notified.','success')
    } catch(e:any) { toast(e.message||'Submission failed','error') }
    setBusy(false); setStep('')
  }

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:26,fontWeight:800,color:'#1e293b',letterSpacing:'-0.5px'}}>{t('rep_title')}</div>
        <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>{t('rep_sub')}</div>
      </div>

      {result && (
        <div style={{borderRadius:20,padding:28,background:LEVEL_GRAD[result.level as Level],color:'#fff',marginBottom:28,position:'relative',overflow:'hidden',animation:'fadeUp 0.4s ease',boxShadow:'0 12px 40px rgba(0,0,0,0.15)'}}>
          <div style={{position:'absolute',right:24,top:24,fontSize:80,opacity:0.12}}>🧠</div>
          <div style={{fontSize:12,fontWeight:700,opacity:0.8,textTransform:'uppercase',letterSpacing:2,marginBottom:10}}>{t('rep_result_done')}</div>
          <div style={{fontSize:28,fontWeight:800,marginBottom:8}}>{result.level} — {result.emType}</div>
          <div style={{fontSize:15,opacity:0.95,marginBottom:16,lineHeight:1.6}}>{result.action}</div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <span style={{background:'rgba(255,255,255,0.22)',padding:'7px 16px',borderRadius:20,fontSize:13,fontWeight:600}}>{t('rep_confidence')} {(result.confidence*100).toFixed(0)}%</span>
            {result.shortCircuited && <span style={{background:'rgba(255,255,255,0.22)',padding:'7px 16px',borderRadius:20,fontSize:13,fontWeight:600}}>{t('rep_vision_sc')}</span>}
            {result.dispatch?.assignedName
              ? <span style={{background:'rgba(255,255,255,0.22)',padding:'7px 16px',borderRadius:20,fontSize:13,fontWeight:600}}>{t('rep_auto_assign')} {result.dispatch.assignedName}</span>
              : <span style={{background:'rgba(255,255,255,0.22)',padding:'7px 16px',borderRadius:20,fontSize:13,fontWeight:600}}>{t('rep_notified')}</span>
            }
            <span style={{background:'rgba(255,255,255,0.22)',padding:'7px 16px',borderRadius:20,fontSize:13,fontWeight:600}}>{t('rep_saved')}</span>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
        {/* Text */}
        <div className="card" style={{gridColumn:'span 2'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:12}}>{t('rep_desc_label')} <span style={{fontSize:12,color:'#94a3b8',fontWeight:400}}>{t('rep_desc_hint')}</span></div>
          <textarea value={text} onChange={e=>setText(e.target.value)} rows={4}
            placeholder={t('rep_desc_ph')}
            className="input" style={{height:120,resize:'vertical',lineHeight:1.7}}/>
        </div>

        {/* Image */}
        <div className="card">
          <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:12}}>{t('rep_img_label')} <span style={{fontSize:12,color:'#94a3b8',fontWeight:400}}>{t('rep_img_hint')}</span></div>
          {imgPrev ? (
            <div style={{position:'relative'}}>
              <img src={imgPrev} style={{width:'100%',borderRadius:12,maxHeight:180,objectFit:'cover'}} alt="scene"/>
              <button onClick={()=>{setImgB64(null);setImgPrev(null)}} style={{position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.65)',color:'#fff',border:'none',borderRadius:20,padding:'4px 12px',fontSize:12,cursor:'pointer'}}>{t('rep_img_remove')}</button>
              <div style={{marginTop:8,fontSize:12,color:'#16a34a',fontWeight:600}}>{t('rep_img_vision')}</div>
            </div>
          ) : (
            <label style={{display:'block',border:'2px dashed #e2e8f0',borderRadius:14,padding:'32px 16px',textAlign:'center',cursor:'pointer',transition:'border 0.2s',background:'#fafbff'}}>
              <input type="file" accept="image/*" capture="environment" onChange={handleImg} style={{display:'none'}}/>
              <div style={{fontSize:40,marginBottom:10}}>📸</div>
              <div style={{fontSize:14,color:'#64748b',fontWeight:600}}>{t('rep_img_tap')}</div>
              <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{t('rep_img_auto')}</div>
            </label>
          )}
        </div>

        {/* Voice */}
        <div className="card">
          <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:12}}>{t('rep_voice_label')} <span style={{fontSize:12,color:'#94a3b8',fontWeight:400}}>{t('rep_voice_hint')}</span></div>
          <div style={{textAlign:'center',padding:'16px 0'}}>
            {audioB64 ? (
              <div>
                <div style={{width:64,height:64,borderRadius:'50%',background:'#f0fdf4',border:'2px solid #16a34a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 12px'}}>✅</div>
                <div style={{fontSize:13,color:'#16a34a',fontWeight:700,marginBottom:14}}>{t('rep_voice_ok')}</div>
                <button className="btn-outline" onClick={()=>setAudio(null)}>{t('rep_rerec')}</button>
              </div>
            ) : (
              <>
                <button onMouseDown={startRec} onMouseUp={stopRec} onTouchStart={startRec} onTouchEnd={stopRec}
                  style={{width:80,height:80,borderRadius:'50%',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',fontSize:32,background:recoding?'linear-gradient(135deg,#ff416c,#ff4b2b)':'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',boxShadow:recoding?'0 0 0 14px rgba(255,65,108,0.2)':'0 6px 24px rgba(99,102,241,0.4)',transition:'all 0.2s'}}>
                  {recoding?'⏹':'🎙️'}
                </button>
                <div style={{fontSize:14,color:recoding?'#dc2626':'#64748b',fontWeight:600}}>{recoding?t('rep_recording'):t('rep_hold')}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{t('rep_voice_langs')}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline status */}
      {busy && (
        <div className="card" style={{marginBottom:20,borderLeft:'4px solid #6366f1'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:14}}>{t('rep_pipeline')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {[
              {key:'vision',   label:'Google Vision API — Scene Analysis',           skip:!imgB64},
              {key:'speech',   label:'Google Speech API — Voice Transcription',       skip:!audioB64},
              {key:'groq',     label:'Llama 3.3 — Emergency Classification',     skip:false},
              {key:'dispatch', label:'Auto-Dispatch — Notifying Volunteers',          skip:false},
            ].map(s=>{
              const done = !busy || (step!==s.key && ['groq','dispatch',''].includes(step) && s.key==='vision')
              return (
                <div key={s.key} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 16px',borderRadius:12,background:s.skip?'#f8fafc':step===s.key?'#eff6ff':'#f8faff',border:`1px solid ${s.skip?'#f0f4ff':step===s.key?'#c7d2fe':'#e0e7ff'}`}}>
                  {s.skip ? <span style={{fontSize:16,color:'#cbd5e1'}}>—</span> : step===s.key ? <Spinner size={16}/> : <span style={{color:'#16a34a',fontWeight:700,fontSize:16}}>✓</span>}
                  <span style={{fontSize:13,fontWeight:600,color:s.skip?'#94a3b8':step===s.key?'#6366f1':'#334155'}}>{s.label}</span>
                  {s.skip && <span style={{marginLeft:'auto',fontSize:11,color:'#94a3b8'}}>{t('rep_no_input')}</span>}
                  {step===s.key && <span style={{marginLeft:'auto',fontSize:11,color:'#6366f1',fontWeight:600}}>{t('rep_running')}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={handleSubmit} disabled={busy} style={{width:'100%',justifyContent:'center',padding:16,fontSize:16,borderRadius:14}}>
        {busy?<><Spinner size={20} color="#fff"/> {t('rep_busy_btn')}</>:t('rep_submit')}
      </button>

      <div style={{marginTop:16,padding:14,background:'#f0f4ff',borderRadius:12,fontSize:13,color:'#64748b',display:'flex',gap:10,alignItems:'flex-start'}}>
        <span style={{fontSize:18}}>ℹ️</span>
        <span>{t('rep_info')}</span>
      </div>
    </div>
  )
}

// ─── ANALYTICS PAGE ───────────────────────────────────────────────────────────
function AnalyticsPage({ cases, user }: { cases: EmCase[]; user: AppUser }) {
  const [volunteers, setVolunteers] = useState<AppUser[]>([])
  const [range, setRange] = useState<7 | 30 | 90>(30)
  const { t } = useLang()

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'volunteer')),
      snap => setVolunteers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    )
  }, [])

  const now = Date.now()
  const inRange = cases.filter(c => now - c.createdAt.getTime() < range * 86_400_000)
  const resolved = inRange.filter(c => c.status === 'RESOLVED')

  // Cases per day (last 7 days for sparkline)
  const last7: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000)
    last7[d.toLocaleDateString('en-IN', { weekday: 'short' })] = 0
  }
  inRange.forEach(c => {
    const key = c.createdAt.toLocaleDateString('en-IN', { weekday: 'short' })
    if (key in last7) last7[key]++
  })

  const byLevel = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Level[]).map(l => ({
    level: l,
    count: inRange.filter(c => c.level === l).length,
  }))

  const byType = ['MEDICAL', 'ACCIDENT', 'FIRE', 'FLOOD', 'VIOLENCE', 'OTHER'].map(t => ({
    type: t,
    count: inRange.filter(c => c.emType === t).length,
  })).filter(x => x.count > 0).sort((a, b) => b.count - a.count)

  const avgResponse = resolved.length
    ? Math.round(
        resolved
          .filter(c => (c as any).responseTimeMinutes)
          .reduce((a, c) => a + (c as any).responseTimeMinutes, 0) /
          resolved.filter(c => (c as any).responseTimeMinutes).length
      )
    : null

  const resolutionRate = inRange.length
    ? Math.round((resolved.length / inRange.length) * 100)
    : 0

  const maxDay = Math.max(...Object.values(last7), 1)

  const topVols = [...volunteers]
    .sort((a, b) => (b.casesHandled || 0) - (a.casesHandled || 0))
    .slice(0, 5)

  return (
    <div style={{ padding: 32, animation: 'fadeUp 0.4s ease' }}>
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', letterSpacing: '-0.5px' }}>{t('an_title')}</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 4 }}>{t('an_sub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: '#f0f4ff', borderRadius: 10, padding: 4 }}>
          {([7, 30, 90] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontSize: 13, fontWeight: 700, background: range === r ? '#6366f1' : 'transparent', color: range === r ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 28 }}>
        <StatCard label={t('an_total')}      value={inRange.length}            grad="linear-gradient(135deg,#6366f1,#8b5cf6)" icon="📋" sub={`${t('an_last')} ${range} ${t('an_days')}`} />
        <StatCard label={t('an_resolved')}    value={resolved.length}           grad="linear-gradient(135deg,#10b981,#34d399)" icon="✅" sub={`${resolutionRate}% ${t('an_rate')}`} />
        <StatCard label={t('an_avg_resp')}    value={avgResponse ? `${avgResponse}m` : '—'} grad="linear-gradient(135deg,#3b82f6,#06b6d4)" icon="⚡" />
        <StatCard label={t('an_active_vols')} value={volunteers.filter(v => v.available).length} grad="linear-gradient(135deg,#f59e0b,#f97316)" icon="👥" sub={`${t('an_of_total')} ${volunteers.length} ${t('an_total2')}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Daily trend */}
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>{t('an_trend')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
            {Object.entries(last7).map(([day, count]) => (
              <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1' }}>{count > 0 ? count : ''}</div>
                <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: count > 0 ? 'linear-gradient(180deg,#6366f1,#8b5cf6)' : '#f0f4ff', height: `${Math.max((count / maxDay) * 80, count > 0 ? 12 : 4)}px`, transition: 'height 0.5s ease' }} />
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{day}</div>
              </div>
            ))}
          </div>
        </div>

        {/* By severity */}
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>{t('an_severity')}</div>
          {byLevel.map(({ level, count }) => (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <LevelBadge level={level} />
              <div style={{ flex: 1, height: 8, background: '#f0f4ff', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${inRange.length ? (count / inRange.length) * 100 : 0}%`, background: LEVEL_COLOR[level], borderRadius: 4, transition: 'width 0.8s ease' }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', minWidth: 24, textAlign: 'right' }}>{count}</span>
              <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 36 }}>{inRange.length ? Math.round((count / inRange.length) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* By type */}
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>{t('an_types')}</div>
          {byType.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0', fontSize: 13 }}>{t('an_no_data')}</div>
          ) : byType.map(({ type, count }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ background: '#f0f4ff', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, color: '#6366f1', minWidth: 80, textAlign: 'center' }}>{type}</span>
              <div style={{ flex: 1, height: 8, background: '#f0f4ff', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${inRange.length ? (count / inRange.length) * 100 : 0}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', minWidth: 20, textAlign: 'right' }}>{count}</span>
            </div>
          ))}
        </div>

        {/* Volunteer leaderboard */}
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>{t('an_leaderboard')}</div>
          {topVols.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0', fontSize: 13 }}>{t('an_no_vols')}</div>
          ) : topVols.map((v, i) => (
            <div key={v.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < topVols.length - 1 ? '1px solid #f0f4ff' : 'none' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? '#fef3c7' : i === 1 ? '#f1f5f9' : '#fdf2e9', color: i === 0 ? '#d97706' : i === 1 ? '#64748b' : '#c2410c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
              </div>
              <Avatar name={getName(v)} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{getName(v)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{v.skills?.join(', ') || 'General'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1' }}>{v.casesHandled || 0} {t('cd_cases')}</div>
                <div style={{ fontSize: 11, color: '#f59e0b' }}>★ {v.rating?.toFixed(1) || '5.0'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────
function ProfilePage({ user }: { user: AppUser }) {
  const toast = useToast()
  const { refreshProfile } = useAuth()
  const { t } = useLang()
  const [name, setName]         = useState(getName(user))
  const [phone, setPhone]       = useState(user.phone || '')
  const [available, setAvail]   = useState(user.available ?? false)
  const [skills, setSkills]     = useState((user.skills || []).join(', '))
  const [busy, setBusy]         = useState(false)
  const [changed, setChanged]   = useState(false)

  useEffect(() => { setChanged(true) }, [name, phone, available, skills])

  async function save() {
    if (!name.trim()) { toast('Name cannot be empty', 'error'); return }
    setBusy(true)
    try {
      const updates: Record<string, any> = {
        name: name.trim(),
        phone: phone.trim(),
        available,
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
      }
      await updateDoc(doc(db, 'users', user.uid), updates)
      await refreshProfile()
      setChanged(false)
      toast('Profile updated!', 'success')
    } catch { toast('Update failed', 'error') }
    setBusy(false)
  }

  async function toggleAvailability() {
    const next = !available
    setAvail(next)
    try {
      await updateDoc(doc(db, 'users', user.uid), { available: next })
      await refreshProfile()
      toast(`You are now ${next ? 'available' : 'unavailable'}`, next ? 'success' : 'info')
    } catch { toast('Update failed', 'error') }
  }

  return (
    <div style={{ padding: 32, animation: 'fadeUp 0.4s ease' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', letterSpacing: '-0.5px' }}>{t('pr_title')}</div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 4 }}>{t('pr_sub')}</div>
      </div>

      {/* Header card */}
      <div className="card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Avatar name={getName(user)} size={72} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{getName(user)}</div>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>{user.email}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#ede9fe', color: '#6366f1', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{user.role}</span>
            {user.role === 'volunteer' && (
              <span style={{ background: available ? '#f0fdf4' : '#fff7ed', color: available ? '#16a34a' : '#ea580c', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                {available ? t('pr_available') : t('pr_unavailable')}
              </span>
            )}
          </div>
        </div>
        {user.role === 'volunteer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{t('pr_availability')}</div>
            <button onClick={toggleAvailability}
              style={{ padding: '10px 20px', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontSize: 13, fontWeight: 700, background: available ? 'linear-gradient(135deg,#ff416c,#ff4b2b)' : 'linear-gradient(135deg,#10b981,#34d399)', color: '#fff', boxShadow: available ? '0 4px 14px rgba(255,65,108,0.3)' : '0 4px 14px rgba(16,185,129,0.3)', transition: 'all 0.2s' }}>
              {available ? t('pr_go_unavail') : t('pr_go_avail')}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Edit details */}
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>{t('pr_edit')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>{t('pr_fullname')}</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={t('pr_fullname_ph')} />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>{t('pr_phone')}</label>
              <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('pr_phone_ph')} />
            </div>
            {user.role === 'volunteer' && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>{t('pr_skills')} <span style={{ fontWeight: 400, color: '#94a3b8' }}>{t('pr_skills_hint')}</span></label>
                <input className="input" value={skills} onChange={e => setSkills(e.target.value)} placeholder={t('pr_skills_ph')} />
              </div>
            )}
            <button className="btn-primary" onClick={save} disabled={busy} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              {busy ? <Spinner size={16} color="#fff" /> : t('pr_save')}
            </button>
          </div>
        </div>

        {/* Stats / Role info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {user.role === 'volunteer' && (
            <div className="card">
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>📊 Your Stats</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Cases Handled', value: user.casesHandled || 0, icon: '📋' },
                  { label: 'Rating', value: `★ ${user.rating?.toFixed(1) || '5.0'}`, icon: '⭐' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#f8fafc', borderRadius: 12, padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{s.icon}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#6366f1' }}>{s.value}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {user.skills && user.skills.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Skills</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {user.skills.map(s => (
                      <span key={s} style={{ background: '#ede9fe', color: '#6366f1', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', color: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>🛡️ Account Info</div>
            {[
              ['Role',     user.role.charAt(0).toUpperCase() + user.role.slice(1)],
              ['User ID',  user.uid.slice(0, 10) + '...'],
              ['Email',    user.email],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.15)', fontSize: 13 }}>
                <span style={{ opacity: 0.8 }}>{k}</span>
                <strong style={{ maxWidth: 200, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── CASES PAGE ───────────────────────────────────────────────────────────────
function CasesPage({ cases, user, onNavigate }: { cases:EmCase[]; user:AppUser; onNavigate:(p:Page,id?:string)=>void }) {
  const [filter, setFilter] = useState<Status|'ALL'>('ALL')
  const [level,  setLevel]  = useState<Level|'ALL'>('ALL')
  const [search, setSearch] = useState('')

  const visible = cases.filter(c=>{
    if (filter!=='ALL'&&c.status!==filter) return false
    if (level!=='ALL'&&c.level!==level)   return false
    if (search) { const q=search.toLowerCase(); if (!c.description?.toLowerCase().includes(q)&&!c.reporterName?.toLowerCase().includes(q)&&!c.emType?.toLowerCase().includes(q)) return false }
    return true
  })

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:26,fontWeight:800,color:'#1e293b'}}>All Cases</div>
        <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>{cases.length} total · {cases.filter(c=>c.status==='PENDING').length} pending</div>
      </div>

      <div className="card" style={{marginBottom:20}}>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <input placeholder="🔍  Search cases..." value={search} onChange={e=>setSearch(e.target.value)} className="input" style={{width:220}}/>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {(['ALL','PENDING','ASSIGNED','IN_PROGRESS','RESOLVED'] as const).map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{padding:'7px 14px',border:'none',borderRadius:20,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:700,background:filter===f?'#6366f1':'#f0f4ff',color:filter===f?'#fff':'#64748b',transition:'all 0.15s'}}>
                {f==='ALL'?'All':f.replace('_',' ')} ({f==='ALL'?cases.length:cases.filter(c=>c.status===f).length})
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginLeft:'auto'}}>
            {(['ALL','CRITICAL','HIGH','MEDIUM','LOW'] as const).map(l=>(
              <button key={l} onClick={()=>setLevel(l)} style={{padding:'7px 14px',border:'none',borderRadius:20,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:700,background:level===l?(l==='ALL'?'#64748b':LEVEL_COLOR[l as Level]):'#f0f4ff',color:level===l?'#fff':(l==='ALL'?'#64748b':LEVEL_COLOR[l as Level]),transition:'all 0.15s'}}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        {visible.length===0 ? (
          <div style={{textAlign:'center',padding:'48px 0',color:'#94a3b8'}}><div style={{fontSize:40,marginBottom:10}}>📭</div><div>No cases match your filter</div></div>
        ) : (
          <table>
            <thead><tr><th>ID</th><th>Reporter</th><th>Type</th><th>Level</th><th>Status</th><th>Assigned</th><th>Time</th><th></th></tr></thead>
            <tbody>
              {visible.map(c=>(
                <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>onNavigate('case_detail',c.id)}>
                  <td style={{fontSize:12,color:'#94a3b8',fontFamily:'monospace'}}>#{c.id.slice(-5).toUpperCase()}</td>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}><Avatar name={c.reporterName} size={28}/><span style={{fontWeight:600}}>{c.reporterName}</span></div></td>
                  <td><span style={{background:'#f0f4ff',padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:700,color:'#6366f1'}}>{c.emType}</span></td>
                  <td><LevelBadge level={c.level}/></td>
                  <td><StatusBadge status={c.status}/></td>
                  <td style={{fontSize:13,color:c.assignedName?'#16a34a':'#94a3b8'}}>{c.assignedName||'—'}</td>
                  <td style={{fontSize:12,color:'#94a3b8',whiteSpace:'nowrap'}}>{timeAgo(c.createdAt)}</td>
                  <td><button className="btn-outline" onClick={e=>{e.stopPropagation();onNavigate('case_detail',c.id)}} style={{padding:'6px 14px',fontSize:12}}>View →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── CASE DETAIL ──────────────────────────────────────────────────────────────
function CaseDetailPage({ caseId, user, onBack }: { caseId:string; user:AppUser; onBack:()=>void }) {
  const toast = useToast()
  const [cas, setCas]             = useState<EmCase|null>(null)
  const [notes, setNotes]         = useState<Note[]>([])
  const [availVols, setAvailVols] = useState<AppUser[]>([])
  const [newNote, setNote]        = useState('')
  const [busy, setBusy]           = useState(false)
  const [resolveNote, setRNote]   = useState('')
  const [showModal, setModal]     = useState(false)

  useEffect(()=>{
    const u1=onSnapshot(doc(db,'cases',caseId),snap=>{ if(!snap.exists())return; const d=snap.data(); setCas({id:snap.id,...d,createdAt:toDate(d.createdAt)} as EmCase) })
    const u2=onSnapshot(query(collection(db,'cases',caseId,'notes'),orderBy('createdAt','asc')),snap=>{ setNotes(snap.docs.map(d=>({id:d.id,...d.data(),createdAt:toDate(d.data().createdAt)} as Note))) })
    // All volunteers — filter available client-side to avoid index requirement
    const u3=onSnapshot(query(collection(db,'users'),where('role','==','volunteer')),snap=>{ setAvailVols(snap.docs.map(d=>({uid:d.id,...d.data()} as AppUser)).filter(v=>v.available)) })
    return ()=>{ u1(); u2(); u3() }
  },[caseId])

  // ── generic status update ───────────────────────────────────────────────────
  async function setStatus(status:Status, extra:Record<string,any>={}) {
    setBusy(true)
    try { await updateDoc(doc(db,'cases',caseId),{status,updatedAt:serverTimestamp(),...extra}); toast(`Status → ${status}`,'success') }
    catch { toast('Update failed','error') }
    setBusy(false)
  }

  // ── VOLUNTEER: "I'm On My Way" ─────────────────────────────────────────────
  async function startResponding() {
    if (!cas) return
    await setStatus('IN_PROGRESS')
    try { await addDoc(collection(db,'cases',caseId,'notes'),{author:'System',text:`${getName(user)} is now en route and responding.`,createdAt:serverTimestamp()}) } catch {}
  }

  // ── VOLUNTEER: Resolve ─────────────────────────────────────────────────────
  async function resolveCase() {
    if (!cas) return
    setBusy(true)
    try {
      const min = Math.round((Date.now()-cas.createdAt.getTime())/60_000)
      await updateDoc(doc(db,'cases',caseId),{status:'RESOLVED',resolvedAt:serverTimestamp(),resolvedByName:getName(user),responseTimeMinutes:min,updatedAt:serverTimestamp()})
      await updateDoc(doc(db,'users',user.uid),{available:true,casesHandled:(user.casesHandled||0)+1})
      const closing = resolveNote.trim() || `Case closed by ${getName(user)} after ${min} min response time.`
      await addDoc(collection(db,'cases',caseId,'notes'),{author:getName(user),text:`[RESOLVED] ${closing}`,createdAt:serverTimestamp()})
      await addDoc(collection(db,'alerts'),{userId:cas.reporterId,title:'✅ Your emergency has been resolved',body:`Case #${caseId.slice(-5).toUpperCase()} (${cas.emType}) resolved by ${getName(user)} in ${min} min.`,level:cas.level,caseId,read:false,createdAt:serverTimestamp()})
      const coords=await getDocs(query(collection(db,'users'),where('role','==','coordinator')))
      for(const c of coords.docs) await addDoc(collection(db,'alerts'),{userId:c.id,title:`✅ Resolved — ${cas.emType}`,body:`Case #${caseId.slice(-5).toUpperCase()} closed by ${getName(user)} in ${min} min.`,level:cas.level,caseId,read:false,createdAt:serverTimestamp()})
      setModal(false); setRNote('')
      toast(`Case resolved in ${min} min! Great work 🎉`,'success')
    } catch(e){ console.error(e); toast('Failed to resolve','error') }
    setBusy(false)
  }

  // ── COORDINATOR: force resolve ─────────────────────────────────────────────
  async function coordResolve() {
    if (!cas) return; setBusy(true)
    try {
      const min=Math.round((Date.now()-cas.createdAt.getTime())/60_000)
      await updateDoc(doc(db,'cases',caseId),{status:'RESOLVED',resolvedAt:serverTimestamp(),resolvedByName:`${getName(user)} (Coordinator)`,responseTimeMinutes:min,updatedAt:serverTimestamp()})
      if(cas.assignedTo) await updateDoc(doc(db,'users',cas.assignedTo),{available:true})
      await addDoc(collection(db,'alerts'),{userId:cas.reporterId,title:'✅ Case resolved by coordinator',body:`Case #${caseId.slice(-5).toUpperCase()} closed.`,level:cas.level,caseId,read:false,createdAt:serverTimestamp()})
      await addDoc(collection(db,'cases',caseId,'notes'),{author:'System',text:`[RESOLVED by Coordinator] ${getName(user)} force-closed this case.`,createdAt:serverTimestamp()})
      toast('Case resolved','success')
    } catch { toast('Failed','error') }
    setBusy(false)
  }

  // ── COORDINATOR: re-open ────────────────────────────────────────────────────
  async function reopenCase() {
    await setStatus('PENDING',{resolvedAt:null,resolvedByName:null,responseTimeMinutes:null})
    try { await addDoc(collection(db,'cases',caseId,'notes'),{author:'System',text:`Case re-opened by ${getName(user)}.`,createdAt:serverTimestamp()}) } catch {}
    toast('Case re-opened','info')
  }

  // ── COORDINATOR: assign volunteer ──────────────────────────────────────────
  async function assignVol(vol:AppUser) {
    if (!cas) return; setBusy(true)
    try {
      const vn=getName(vol)
      await Promise.all([
        updateDoc(doc(db,'cases',caseId),{assignedTo:vol.uid,assignedName:vn,status:'ASSIGNED',updatedAt:serverTimestamp()}),
        updateDoc(doc(db,'users',vol.uid),{available:false}),
        addDoc(collection(db,'alerts'),{userId:vol.uid,title:'🚨 Case Assigned to You',body:`${cas.level} ${cas.emType} at ${cas.address}`,level:cas.level,caseId,read:false,createdAt:serverTimestamp()}),
      ])
      await addDoc(collection(db,'cases',caseId,'notes'),{author:'System',text:`${vn} assigned by ${getName(user)}.`,createdAt:serverTimestamp()})
      toast(`Assigned to ${vn}`,'success')
    } catch { toast('Assignment failed','error') }
    setBusy(false)
  }

  // ── COORDINATOR: release volunteer ─────────────────────────────────────────
  async function releaseVol() {
    if (!cas?.assignedTo) return; setBusy(true)
    try {
      await Promise.all([
        updateDoc(doc(db,'cases',caseId),{assignedTo:null,assignedName:null,status:'PENDING',updatedAt:serverTimestamp()}),
        updateDoc(doc(db,'users',cas.assignedTo),{available:true}),
      ])
      await addDoc(collection(db,'cases',caseId,'notes'),{author:'System',text:`Volunteer released by ${getName(user)}.`,createdAt:serverTimestamp()})
      toast('Volunteer released','success')
    } catch { toast('Failed','error') }
    setBusy(false)
  }

  async function addNote() {
    if (!newNote.trim()) return
    try { await addDoc(collection(db,'cases',caseId,'notes'),{author:getName(user),text:newNote.trim(),createdAt:serverTimestamp()}); setNote(''); toast('Note added','success') }
    catch { toast('Failed','error') }
  }

  if (!cas) return <div style={{padding:32,display:'flex',alignItems:'center',gap:12}}><Spinner/><span style={{color:'#64748b'}}>Loading case...</span></div>

  const isMyCase   = user.role==='volunteer' && cas.assignedTo===user.uid
  const isCoord    = user.role==='coordinator'
  const isResolved = cas.status==='RESOLVED'

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <button onClick={onBack} style={{background:'none',border:'none',color:'#64748b',fontFamily:'Plus Jakarta Sans',fontSize:14,fontWeight:600,cursor:'pointer',marginBottom:20,display:'flex',alignItems:'center',gap:6,padding:0}}>← Back to Cases</button>

      {/* Hero */}
      <div style={{borderRadius:20,padding:28,background:LEVEL_GRAD[cas.level],color:'#fff',marginBottom:20,position:'relative',overflow:'hidden',boxShadow:'0 12px 40px rgba(0,0,0,0.15)'}}>
        <div style={{position:'absolute',right:28,top:28,fontSize:80,opacity:0.12}}>🚨</div>
        <div style={{fontSize:11,fontWeight:700,opacity:0.8,textTransform:'uppercase',letterSpacing:2,marginBottom:10}}>Case #{cas.id.slice(-6).toUpperCase()}</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <span style={{background:'rgba(255,255,255,0.25)',padding:'5px 16px',borderRadius:20,fontSize:13,fontWeight:700}}>{cas.level}</span>
          <span style={{background:'rgba(255,255,255,0.25)',padding:'5px 16px',borderRadius:20,fontSize:13,fontWeight:700}}>{cas.emType}</span>
          <span style={{background:'rgba(255,255,255,0.25)',padding:'5px 16px',borderRadius:20,fontSize:13,fontWeight:700}}>{cas.status.replace('_',' ')}</span>
          {cas.shortCircuited && <span style={{background:'rgba(255,255,255,0.25)',padding:'5px 16px',borderRadius:20,fontSize:12,fontWeight:700}}>⚡ Vision AI</span>}
        </div>
        <div style={{fontSize:15,opacity:0.95,lineHeight:1.6,maxWidth:640}}>{cas.action}</div>
        <div style={{marginTop:10,fontSize:13,opacity:0.75}}>
          Confidence: {(cas.confidence*100).toFixed(0)}% · Reported {timeAgo(cas.createdAt)} by {cas.reporterName}
          {(cas as any).resolvedByName ? ` · Resolved by ${(cas as any).resolvedByName}` : ''}
          {(cas as any).responseTimeMinutes ? ` in ${(cas as any).responseTimeMinutes} min` : ''}
        </div>
      </div>

      {/* ══ VOLUNTEER ACTION PANEL ══════════════════════════════════════════════ */}
      {isMyCase && !isResolved && (
        <div style={{background:'#fff',border:'2px solid #6366f1',borderRadius:18,padding:'22px 26px',marginBottom:20,boxShadow:'0 4px 24px rgba(99,102,241,0.14)'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
            <div style={{width:48,height:48,borderRadius:14,background:'linear-gradient(135deg,#6366f1,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0,boxShadow:'0 4px 12px rgba(99,102,241,0.35)'}}>👤</div>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>You are the responding volunteer</div>
              <div style={{fontSize:13,color:'#64748b',marginTop:2}}>Status: <span style={{fontWeight:700,color:STATUS_COLOR[cas.status]}}>{cas.status.replace('_',' ')}</span></div>
            </div>
          </div>
          {/* Progress stepper */}
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:18}}>
            {(['ASSIGNED','IN_PROGRESS','RESOLVED'] as Status[]).map((s,i)=>(
              <React.Fragment key={s}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:26,height:26,borderRadius:'50%',background:cas.status===s?STATUS_COLOR[s]:'#f0f4ff',color:cas.status===s?'#fff':'#94a3b8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,border:`2px solid ${cas.status===s?STATUS_COLOR[s]:'#e2e8f0'}`}}>{i+1}</div>
                  <span style={{fontSize:11,fontWeight:600,color:cas.status===s?STATUS_COLOR[s]:'#94a3b8'}}>{s.replace('_',' ')}</span>
                </div>
                {i<2 && <div style={{flex:1,height:2,background:'#e2e8f0',minWidth:16}}/>}
              </React.Fragment>
            ))}
          </div>
          {/* Action buttons */}
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            {cas.status==='ASSIGNED' && (
              <button onClick={startResponding} disabled={busy} style={{padding:'11px 22px',border:'none',borderRadius:11,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:14,fontWeight:700,background:'linear-gradient(135deg,#3b82f6,#06b6d4)',color:'#fff',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 14px rgba(59,130,246,0.35)',transition:'all 0.18s',opacity:busy?0.6:1}}>
                ⚡ I'm On My Way
              </button>
            )}
            <button onClick={()=>setModal(true)} disabled={busy} style={{padding:'11px 28px',border:'none',borderRadius:11,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:14,fontWeight:700,background:'linear-gradient(135deg,#10b981,#34d399)',color:'#fff',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 16px rgba(16,185,129,0.4)',transition:'all 0.18s',opacity:busy?0.6:1}}>
              ✅ Mark as Resolved
            </button>
          </div>
          {/* Inline resolve modal */}
          {showModal && (
            <div style={{marginTop:16,background:'#f0fdf4',border:'1.5px solid #bbf7d0',borderRadius:14,padding:'18px 20px',animation:'fadeUp 0.3s ease'}}>
              <div style={{fontSize:14,fontWeight:700,color:'#15803d',marginBottom:10}}>📝 Closing note (optional)</div>
              <textarea rows={3} placeholder="e.g. Patient stabilised, transferred to hospital. Scene secured." value={resolveNote} onChange={e=>setRNote(e.target.value)}
                style={{width:'100%',border:'1.5px solid #bbf7d0',borderRadius:10,padding:'10px 14px',fontSize:13,fontFamily:'Plus Jakarta Sans',resize:'vertical',background:'#fff',boxSizing:'border-box',outline:'none',color:'#1e293b'}}/>
              <div style={{display:'flex',gap:10,marginTop:12}}>
                <button onClick={resolveCase} disabled={busy} style={{padding:'10px 22px',border:'none',borderRadius:10,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:700,background:'linear-gradient(135deg,#10b981,#34d399)',color:'#fff',display:'flex',alignItems:'center',gap:7,opacity:busy?0.6:1}}>
                  {busy?<><Spinner size={14} color="#fff"/> Saving...</>:'✅ Confirm Resolved'}
                </button>
                <button onClick={()=>setModal(false)} style={{padding:'10px 18px',border:'1.5px solid #e2e8f0',borderRadius:10,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:600,background:'#fff',color:'#64748b'}}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resolved banner for volunteer */}
      {isMyCase && isResolved && (
        <div style={{background:'linear-gradient(135deg,#10b981,#34d399)',borderRadius:16,padding:'18px 24px',marginBottom:20,display:'flex',alignItems:'center',gap:14,color:'#fff',boxShadow:'0 6px 20px rgba(16,185,129,0.35)'}}>
          <div style={{fontSize:32,flexShrink:0}}>🎉</div>
          <div>
            <div style={{fontSize:16,fontWeight:800}}>Case Resolved — Great Work!</div>
            <div style={{fontSize:13,opacity:0.9,marginTop:2}}>{(cas as any).responseTimeMinutes?`Resolved in ${(cas as any).responseTimeMinutes} min. `:''}Reporter and coordinators have been notified.</div>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
        {/* Left — info */}
        <div className="card">
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:16}}>📋 Case Information</div>
          {([
            ['ID',          `#${cas.id.slice(-6).toUpperCase()}`],
            ['Reporter',    cas.reporterName],
            ['Location',    cas.address],
            ['Assigned To', cas.assignedName||'Unassigned'],
            ['Reported',    toDate(cas.createdAt).toLocaleString('en-IN')],
            ...((cas as any).responseTimeMinutes ? [['Response Time', `${(cas as any).responseTimeMinutes} min`]] : []),
            ...((cas as any).resolvedByName      ? [['Resolved By',  (cas as any).resolvedByName]]              : []),
          ] as [string,string][]).map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid #f0f4ff',fontSize:14}}>
              <span style={{color:'#94a3b8',fontWeight:500}}>{k}</span>
              <span style={{color:k==='Assigned To'&&v!=='Unassigned'?'#16a34a':k==='Response Time'?'#6366f1':'#334155',fontWeight:600,textAlign:'right',maxWidth:220}}>{v}</span>
            </div>
          ))}
          <div style={{padding:'12px 0',fontSize:14}}>
            <div style={{color:'#94a3b8',fontWeight:600,marginBottom:6}}>Description</div>
            <div style={{color:'#334155',lineHeight:1.7}}>{cas.description}</div>
          </div>
          {cas.imageUrl && <img src={cas.imageUrl} alt="Scene" style={{width:'100%',borderRadius:12,marginTop:8,maxHeight:180,objectFit:'cover'}}/>}
          {cas.visionLabels&&cas.visionLabels.length>0 && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:11,color:'#94a3b8',fontWeight:700,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Vision Labels</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{cas.visionLabels.map(l=><span key={l} style={{background:'#f0f4ff',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,color:'#6366f1'}}>{l}</span>)}</div>
            </div>
          )}
        </div>

        {/* Right — controls + AI */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          {/* COORDINATOR CONTROLS */}
          {isCoord && (
            <>
              <div className="card">
                <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:14}}>⚡ Status Management</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
                  {(['PENDING','ASSIGNED','IN_PROGRESS'] as Status[]).map(s=>(
                    <button key={s} onClick={()=>setStatus(s)} disabled={busy||cas.status===s}
                      style={{padding:'8px 14px',border:`1.5px solid ${cas.status===s?STATUS_COLOR[s]:'#e2e8f0'}`,borderRadius:20,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:700,background:cas.status===s?STATUS_BG[s]:'#fff',color:cas.status===s?STATUS_COLOR[s]:'#64748b',transition:'all 0.15s',opacity:busy||cas.status===s?0.7:1}}>
                      {s.replace('_',' ')}
                    </button>
                  ))}
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {!isResolved ? (
                    <button onClick={coordResolve} disabled={busy} style={{padding:'9px 18px',border:'none',borderRadius:10,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:700,background:'linear-gradient(135deg,#10b981,#34d399)',color:'#fff',display:'flex',alignItems:'center',gap:6,boxShadow:'0 3px 10px rgba(16,185,129,0.3)',opacity:busy?0.6:1}}>
                      ✅ Force Resolve
                    </button>
                  ) : (
                    <button onClick={reopenCase} disabled={busy} style={{padding:'9px 18px',border:'1.5px solid #f59e0b',borderRadius:10,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:13,fontWeight:700,background:'#fffbeb',color:'#b45309',display:'flex',alignItems:'center',gap:6,opacity:busy?0.6:1}}>
                      🔄 Re-open Case
                    </button>
                  )}
                </div>
              </div>

              <div className="card">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#1e293b'}}>👥 Assign Volunteer</div>
                  {cas.assignedTo && !isResolved && (
                    <button onClick={releaseVol} disabled={busy} className="btn-danger" style={{fontSize:11,padding:'5px 12px'}}>
                      Release
                    </button>
                  )}
                </div>

                {/* Currently assigned — shown at top */}
                {cas.assignedTo && (
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'#f0fdf4',borderRadius:11,marginBottom:12,border:'1.5px solid #bbf7d0'}}>
                    <Avatar name={cas.assignedName||'?'} size={34}/>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,color:'#15803d',fontSize:13}}>{cas.assignedName}</div>
                      <div style={{fontSize:11,color:'#16a34a',fontWeight:600}}>● Currently assigned</div>
                    </div>
                    <span style={{fontSize:11,color:'#16a34a',fontWeight:700}}>✓ Active</span>
                  </div>
                )}

                {/* Volunteer list — all volunteers, coordinator can assign any */}
                {!isResolved && (
                  <>
                    <div style={{fontSize:12,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>
                      {cas.assignedTo ? 'Re-assign to different volunteer:' : 'Select a volunteer to assign:'}
                    </div>
                    {availVols.length === 0 ? (
                      <div style={{textAlign:'center',color:'#94a3b8',padding:'16px 0',fontSize:13}}>
                        <div style={{fontSize:28,marginBottom:6}}>👤</div>
                        No volunteers available right now
                      </div>
                    ) : (
                      <div style={{maxHeight:220,overflowY:'auto',display:'flex',flexDirection:'column',gap:7}}>
                        {availVols.map(v=>{
                          const isCurrentlyAssigned = cas.assignedTo === v.uid
                          return (
                            <div key={v.uid}
                              onClick={()=>{ if (!isCurrentlyAssigned && !busy) assignVol(v) }}
                              style={{display:'flex',alignItems:'center',gap:10,padding:'10px 13px',border:`1.5px solid ${isCurrentlyAssigned?'#bbf7d0':'#e0e7ff'}`,borderRadius:11,cursor:isCurrentlyAssigned?'default':'pointer',background:isCurrentlyAssigned?'#f0fdf4':'#fff',transition:'all 0.15s',opacity:busy?0.6:1}}
                              onMouseEnter={e=>{ if(!isCurrentlyAssigned) e.currentTarget.style.borderColor='#6366f1' }}
                              onMouseLeave={e=>{ if(!isCurrentlyAssigned) e.currentTarget.style.borderColor='#e0e7ff' }}>
                              <Avatar name={getName(v)} size={32}/>
                              <div style={{flex:1}}>
                                <div style={{fontWeight:600,fontSize:13,color:'#1e293b'}}>{getName(v)}</div>
                                <div style={{fontSize:11,color:'#94a3b8'}}>⭐ {v.rating?.toFixed(1)||'5.0'} · {v.casesHandled||0} cases</div>
                              </div>
                              <div style={{flexShrink:0}}>
                                {isCurrentlyAssigned ? (
                                  <span style={{fontSize:11,color:'#16a34a',fontWeight:700}}>✓ Assigned</span>
                                ) : (
                                  <span style={{fontSize:12,background:'#6366f1',color:'#fff',padding:'4px 12px',borderRadius:20,fontWeight:700,display:'inline-block'}}>Assign →</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* AI Analysis — everyone sees this */}
          <div className="card">
            <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:14}}>🎯 AI Analysis</div>
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                <span style={{color:'#64748b'}}>Confidence</span>
                <strong style={{color:LEVEL_COLOR[cas.level]}}>{(cas.confidence*100).toFixed(0)}%</strong>
              </div>
              <div style={{height:8,background:'#f0f4ff',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${cas.confidence*100}%`,background:LEVEL_GRAD[cas.level],borderRadius:4,transition:'width 1s ease'}}/>
              </div>
            </div>
            <div style={{padding:'10px 14px',background:'#f8fafc',borderRadius:10,fontSize:13,color:'#475569',lineHeight:1.6}}>{cas.action}</div>
            {isResolved && (cas as any).responseTimeMinutes && (
              <div style={{marginTop:10,padding:'10px 14px',background:'#f0fdf4',borderRadius:10,border:'1px solid #bbf7d0',display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:20}}>⏱</span>
                <div><div style={{fontSize:11,fontWeight:700,color:'#15803d',textTransform:'uppercase',letterSpacing:0.5}}>Response Time</div><div style={{fontSize:20,fontWeight:800,color:'#15803d'}}>{(cas as any).responseTimeMinutes} min</div></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="card">
        <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:16}}>📝 Team Notes <span style={{fontSize:13,color:'#94a3b8',fontWeight:400}}>— real-time · {notes.length} entries</span></div>
        <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
          {notes.length===0 && <div style={{textAlign:'center',color:'#94a3b8',padding:'20px 0',fontSize:13}}>No notes yet</div>}
          {notes.map(n=>(
            <div key={n.id} style={{background:n.author==='System'?'#f0f4ff':'#f8fafc',borderRadius:12,padding:'11px 16px',border:`1px solid ${n.author==='System'?'#e0e7ff':'#f0f4ff'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  {n.author==='System'?<div style={{width:20,height:20,borderRadius:'50%',background:'#6366f1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10}}>⚙️</div>:<Avatar name={n.author} size={20}/>}
                  <span style={{fontWeight:700,fontSize:12,color:n.author==='System'?'#6366f1':'#334155'}}>{n.author}</span>
                </div>
                <span style={{fontSize:11,color:'#94a3b8'}}>{timeAgo(n.createdAt)}</span>
              </div>
              <div style={{fontSize:13,color:n.text.startsWith('[RESOLVED]')?'#15803d':n.author==='System'?'#4338ca':'#475569',lineHeight:1.5,fontWeight:n.text.startsWith('[RESOLVED]')?600:400}}>{n.text}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:10}}>
          <input className="input" style={{flex:1}} placeholder="Add a note... (Enter to send)" value={newNote} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNote()}/>
          <button className="btn-primary" onClick={addNote} style={{padding:'11px 20px'}}>Send</button>
        </div>
      </div>
    </div>
  )
}

// ─── ALERTS PAGE ──────────────────────────────────────────────────────────────
function AlertsPage({ user, onNavigate }: { user:AppUser; onNavigate:(p:Page,id?:string)=>void }) {
  const toast = useToast()
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(()=>{
    const q = query(collection(db,'alerts'), where('userId','==',user.uid), orderBy('createdAt','desc'))
    return onSnapshot(q, snap=>{ setAlerts(snap.docs.map(d=>({id:d.id,...d.data(),createdAt:toDate(d.data().createdAt)} as Alert))) })
  },[user.uid])

  async function markRead(id:string) {
    await updateDoc(doc(db,'alerts',id),{read:true})
  }
  async function markAllRead() {
    const unread = alerts.filter(a=>!a.read)
    await Promise.all(unread.map(a=>updateDoc(doc(db,'alerts',a.id),{read:true})))
    toast('All alerts marked as read','success')
  }

  const unread = alerts.filter(a=>!a.read).length

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:28}}>
        <div>
          <div style={{fontSize:26,fontWeight:800,color:'#1e293b'}}>🔔 Alerts & Notifications</div>
          <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>{unread} unread · {alerts.length} total</div>
        </div>
        {unread>0 && <button className="btn-outline" onClick={markAllRead}>Mark all read</button>}
      </div>

      {alerts.length===0 ? (
        <div className="card" style={{textAlign:'center',padding:'60px 0',color:'#94a3b8'}}>
          <div style={{fontSize:56,marginBottom:16}}>🔕</div>
          <div style={{fontSize:18,fontWeight:700,color:'#334155',marginBottom:8}}>No alerts yet</div>
          <div style={{fontSize:14}}>You'll be notified here when emergencies are reported or assigned to you</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {alerts.map(a=>(
            <div key={a.id} className="card card-hover" onClick={()=>{ markRead(a.id); if(a.caseId) onNavigate('case_detail',a.caseId) }}
              style={{display:'flex',gap:16,alignItems:'flex-start',opacity:a.read?0.65:1,borderLeft:`4px solid ${LEVEL_COLOR[a.level]||'#6366f1'}`,cursor:'pointer',transition:'all 0.2s'}}>
              <div style={{width:44,height:44,borderRadius:12,background:LEVEL_BG[a.level]||'#f0f4ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>
                {a.title.startsWith('✅')?'✅':a.title.startsWith('🚨')?'🚨':a.level==='CRITICAL'?'🔴':a.level==='HIGH'?'🟠':'🔔'}
              </div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{a.title}</span>
                  {!a.read && <span style={{width:8,height:8,borderRadius:'50%',background:'#6366f1',display:'inline-block'}}/>}
                </div>
                <div style={{fontSize:13,color:'#64748b',lineHeight:1.5}}>{a.body}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:6}}>{timeAgo(a.createdAt)}</div>
              </div>
              <div style={{flexShrink:0}}>
                <LevelBadge level={a.level}/>
                {a.caseId && <div style={{fontSize:11,color:'#6366f1',fontWeight:600,marginTop:4,textAlign:'right'}}>View Case →</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── MAP PAGE ─────────────────────────────────────────────────────────────────
function MapPage({ cases }: { cases:EmCase[] }) {
  const mapRef  = useRef<HTMLDivElement>(null)
  const mapInst = useRef<any>(null)
  const [ready, setReady]       = useState(false)
  const [selected, setSelected] = useState<EmCase|null>(null)
  const [volunteers, setVols]   = useState<AppUser[]>([])
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  useEffect(()=>{
    return onSnapshot(query(collection(db,'users'),where('role','==','volunteer')),snap=>{
      setVols(snap.docs.map(d=>({uid:d.id,...d.data()} as AppUser)))
    })
  },[])

  useEffect(()=>{
    if (!key) return
    function init() {
      if (!mapRef.current) return
      mapInst.current = new (window as any).google.maps.Map(mapRef.current,{
        center:{lat:18.5204,lng:73.8567},zoom:12,mapTypeControl:false,streetViewControl:false,
        styles:[{elementType:'geometry',stylers:[{color:'#f8fafc'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#ffffff'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#bfdbfe'}]},{featureType:'poi',stylers:[{visibility:'off'}]}]
      })
      setReady(true)
    }
    if ((window as any).google?.maps) { init(); return }
    const s=document.createElement('script'); s.src=`https://maps.googleapis.com/maps/api/js?key=${key}`; s.onload=init; document.head.appendChild(s)
  },[])

  useEffect(()=>{
    if (!ready||!mapInst.current) return
    cases.filter(c=>c.lat&&c.lng).forEach(c=>{
      const m=new (window as any).google.maps.Marker({position:{lat:c.lat,lng:c.lng},map:mapInst.current,icon:{path:(window as any).google.maps.SymbolPath.CIRCLE,scale:14,fillColor:LEVEL_COLOR[c.level],fillOpacity:0.9,strokeColor:'#fff',strokeWeight:2}})
      m.addListener('click',()=>setSelected(c))
    })
  },[cases,ready])

  const availVols = volunteers.filter(v=>v.available)

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:26,fontWeight:800,color:'#1e293b'}}>🗺️ Resource Map</div>
        <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>{cases.length} active cases · {availVols.length} volunteers available</div>
      </div>

      <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
        {(['CRITICAL','HIGH','MEDIUM','LOW'] as Level[]).map(l=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:8,background:'#fff',padding:'7px 16px',borderRadius:20,boxShadow:'0 2px 8px rgba(0,0,0,0.06)',border:'1px solid #f0f4ff'}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:LEVEL_COLOR[l]}}/>
            <span style={{fontSize:13,fontWeight:600,color:'#334155'}}>{l}</span>
          </div>
        ))}
        <div style={{display:'flex',alignItems:'center',gap:8,background:'#fff',padding:'7px 16px',borderRadius:20,boxShadow:'0 2px 8px rgba(0,0,0,0.06)',border:'1px solid #f0f4ff'}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:'#6366f1'}}/>
          <span style={{fontSize:13,fontWeight:600,color:'#334155'}}>Volunteer</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:selected?'1fr 320px':'1fr',gap:20}}>
        <div style={{borderRadius:20,overflow:'hidden',boxShadow:'0 4px 20px rgba(0,0,0,0.1)',border:'1px solid #e0e7ff'}}>
          {!key ? (
            <div style={{height:520,display:'flex',alignItems:'center',justifyContent:'center',background:'#f0f4ff',flexDirection:'column',gap:14}}>
              <div style={{fontSize:56}}>🗺️</div>
              <div style={{fontSize:16,color:'#64748b',fontWeight:700}}>Maps API key not configured</div>
              <div style={{fontSize:13,color:'#94a3b8'}}>Add VITE_GOOGLE_MAPS_API_KEY to .env.local</div>
              {/* Fallback list view */}
              <div style={{width:'100%',maxWidth:400,marginTop:16}}>
                {cases.slice(0,5).map(c=>(
                  <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px',background:'#fff',borderRadius:10,marginBottom:8,border:'1px solid #e0e7ff'}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:LEVEL_COLOR[c.level],flexShrink:0}}/>
                    <div style={{flex:1,fontSize:13}}><strong>{c.emType}</strong> — {c.address}</div>
                    <LevelBadge level={c.level}/>
                  </div>
                ))}
              </div>
            </div>
          ) : <div ref={mapRef} style={{width:'100%',height:520}}/>}
        </div>

        {selected && (
          <div className="card" style={{position:'relative'}}>
            <button onClick={()=>setSelected(null)} style={{position:'absolute',top:16,right:16,background:'#f0f4ff',border:'none',fontSize:14,cursor:'pointer',borderRadius:8,width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b'}}>✕</button>
            <div style={{fontSize:12,fontWeight:700,color:LEVEL_COLOR[selected.level],textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>{selected.level} EMERGENCY</div>
            <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>{selected.emType}</div>
            <StatusBadge status={selected.status}/>
            <div style={{marginTop:10,fontSize:13,color:'#64748b',lineHeight:1.5}}>{selected.description?.slice(0,120)}</div>
            <div style={{marginTop:10,fontSize:12,color:'#94a3b8'}}>📍 {selected.address}</div>
            <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>🕐 {timeAgo(selected.createdAt)}</div>
            {selected.assignedName && <div style={{marginTop:10,fontSize:13,color:'#16a34a',fontWeight:700}}>👤 {selected.assignedName}</div>}
            <div style={{marginTop:14,padding:'10px 14px',background:'#f8fafc',borderRadius:10,fontSize:13,color:'#475569',lineHeight:1.5}}>{selected.action}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── VOLUNTEERS ───────────────────────────────────────────────────────────────
function VolunteersPage({ user }: { user:AppUser }) {
  const toast = useToast()
  const [vols, setVols]     = useState<AppUser[]>([])
  const [search, setSearch] = useState('')

  useEffect(()=>onSnapshot(query(collection(db,'users')),snap=>{
    setVols(snap.docs.filter(d=>d.data().role==='volunteer').map(d=>({uid:d.id,...d.data()} as AppUser)))
  }),[])

  async function toggleAvail(v:AppUser) {
    try { await updateDoc(doc(db,'users',v.uid),{available:!v.available}); toast(`${getName(v)} marked ${v.available?'unavailable':'available'}`,'success') }
    catch { toast('Update failed','error') }
  }

  const visible = search ? vols.filter(v=>getName(v).toLowerCase().includes(search.toLowerCase())||v.email?.toLowerCase().includes(search.toLowerCase())) : vols
  const avail = vols.filter(v=>v.available)

  return (
    <div style={{padding:32,animation:'fadeUp 0.4s ease'}}>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:26,fontWeight:800,color:'#1e293b'}}>👥 Volunteer Management</div>
        <div style={{fontSize:14,color:'#94a3b8',marginTop:4}}>{avail.length} available · {vols.length-avail.length} busy · {vols.length} total</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:18,marginBottom:28}}>
        <StatCard label="Available Now"     value={avail.length}                                         grad="linear-gradient(135deg,#10b981,#34d399)" icon="✅"/>
        <StatCard label="Busy / Deployed"   value={vols.length-avail.length}                             grad="linear-gradient(135deg,#f59e0b,#f97316)" icon="⚡"/>
        <StatCard label="Total Cases Done"  value={vols.reduce((a,v)=>a+(v.casesHandled||0),0)}          grad="linear-gradient(135deg,#6366f1,#8b5cf6)" icon="📋"/>
      </div>

      <div className="card">
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <input placeholder="🔍 Search volunteers..." value={search} onChange={e=>setSearch(e.target.value)} className="input" style={{width:240}}/>
          <span style={{fontSize:13,color:'#94a3b8'}}>{visible.length} volunteers</span>
        </div>

        {visible.length===0 ? (
          <div style={{textAlign:'center',padding:'40px 0',color:'#94a3b8'}}>
            <div style={{fontSize:40,marginBottom:10}}>👤</div>
            <div>No volunteers registered</div><div style={{fontSize:13,marginTop:6}}>Users who register as Volunteer appear here</div>
          </div>
        ) : (
          <table>
            <thead><tr><th>Volunteer</th><th>Email</th><th>Rating</th><th>Cases Done</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {visible.map(v=>(
                <tr key={v.uid}>
                  <td><div style={{display:'flex',alignItems:'center',gap:10}}><Avatar name={getName(v)} size={38}/><div><div style={{fontWeight:700,color:'#1e293b'}}>{getName(v)}</div><div style={{fontSize:12,color:'#94a3b8'}}>{v.skills?.join(', ')||'General responder'}</div></div></div></td>
                  <td style={{fontSize:13,color:'#64748b'}}>{v.email}</td>
                  <td><span style={{color:'#f59e0b'}}>★</span> <strong>{v.rating?.toFixed(1)||'5.0'}</strong></td>
                  <td><strong style={{color:'#6366f1'}}>{v.casesHandled||0}</strong></td>
                  <td>
                    <span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'5px 14px',borderRadius:20,fontSize:12,fontWeight:700,background:v.available?'#f0fdf4':'#fff7ed',color:v.available?'#16a34a':'#ea580c'}}>
                      <span style={{width:6,height:6,borderRadius:'50%',background:'currentColor',display:'inline-block'}}/>
                      {v.available?'Available':'Busy'}
                    </span>
                  </td>
                  <td><button className="btn-outline" onClick={()=>toggleAvail(v)} style={{padding:'6px 14px',fontSize:12}}>{v.available?'Mark Busy':'Mark Available'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}



// ─── APP SHELL ────────────────────────────────────────────────────────────────
function AppShell() {
  const {firebaseUser, profile, loading} = useAuth()
  const toast = useToast()
  const { lang, setLang, t } = useLang()
  const [page, setPage]       = useState<Page>('dashboard')
  const [detailId, setDetailId] = useState<string|null>(null)
  const [cases, setCases]     = useState<EmCase[]>([])
  const [unreadAlerts, setUnread] = useState(0)

  useEffect(()=>{
    if (!firebaseUser) return
    const u1 = onSnapshot(query(collection(db,'cases'),orderBy('createdAt','desc')),snap=>{
      setCases(snap.docs.map(d=>({id:d.id,...d.data(),createdAt:toDate(d.data().createdAt)} as EmCase)))
    },()=>{})
    return u1
  },[firebaseUser])

  useEffect(()=>{
    if (!profile) return
    const q = query(collection(db,'alerts'),where('userId','==',profile.uid),where('read','==',false))
    return onSnapshot(q, snap=>setUnread(snap.size), ()=>{})
  },[profile])

  function navigate(p:Page,id?:string) { setPage(p); setDetailId(id||null) }

  async function signOut() {
    try { await fbSignOut(auth); toast('Signed out','info') } catch { toast('Failed','error') }
  }

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f0f4ff',flexDirection:'column',gap:16}}>
      <div style={{width:72,height:72,borderRadius:20,background:'linear-gradient(135deg,#ff416c,#ff4b2b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,boxShadow:'0 8px 24px rgba(255,65,108,0.4)'}}>🚨</div>
      <Spinner size={36}/><div style={{fontSize:14,color:'#94a3b8',fontFamily:'Plus Jakarta Sans'}}>{t('loading_sevak')}</div>
    </div>
  )

  if (!firebaseUser) return <LoginPage/>

  if (!profile) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f0f4ff',flexDirection:'column',gap:16}}>
      <div style={{fontSize:48}}>🚨</div><Spinner size={36}/><div style={{fontSize:14,color:'#94a3b8',fontFamily:'Plus Jakarta Sans'}}>{t('setting_profile')}</div>
    </div>
  )

  const navLabelKey: Record<Page, TKey> = {
    dashboard:   'nav_dashboard',
    report:      'nav_report',
    cases:       'nav_cases',
    analytics:   'nav_analytics',
    map:         'nav_map',
    volunteers:  'nav_volunteers',
    alerts:      'nav_alerts',
    profile:     'nav_profile',
    case_detail: 'nav_cases',
  }
  const navItems   = NAV_ITEMS.filter(n=>n.roles.includes(profile.role))
  const activePage = page==='case_detail'?'cases':page
  const critical   = cases.filter(c=>c.level==='CRITICAL'&&c.status==='PENDING').length

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f0f4ff',fontFamily:'Plus Jakarta Sans'}}>
      <style>{css}</style>

      {/* SIDEBAR */}
      <div style={{width:248,background:'#fff',borderRight:'1px solid #e0e7ff',display:'flex',flexDirection:'column',position:'fixed',top:0,left:0,bottom:0,zIndex:100,boxShadow:'2px 0 20px rgba(99,102,241,0.06)'}}>
        {/* Logo */}
        <div style={{padding:'24px 20px 20px',borderBottom:'1px solid #f0f4ff'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:44,height:44,borderRadius:14,background:'linear-gradient(135deg,#ff416c,#ff4b2b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 12px rgba(255,65,108,0.35)',flexShrink:0}}>🚨</div>
            <div>
              <div style={{fontSize:20,fontWeight:800,color:'#1e293b',letterSpacing:'-0.5px'}}>SEVAK</div>
              <div style={{fontSize:10,color:'#94a3b8',fontWeight:600,textTransform:'uppercase',letterSpacing:1}}>Emergency Response</div>
            </div>
          </div>
        </div>

        {/* User pill */}
        <div style={{margin:'12px 12px 4px',padding:'12px 14px',background:'linear-gradient(135deg,#f0f4ff,#ede9fe)',borderRadius:14,display:'flex',alignItems:'center',gap:10}}>
          <Avatar name={getName(profile)} size={36}/>
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{getName(profile).split(' ')[0]}</div>
            <div style={{fontSize:11,color:'#6366f1',fontWeight:700,textTransform:'capitalize'}}>{profile.role}</div>
          </div>
          {unreadAlerts>0 && <div style={{marginLeft:'auto',width:22,height:22,borderRadius:'50%',background:'#ef4444',color:'#fff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{unreadAlerts>9?'9+':unreadAlerts}</div>}
        </div>

        {/* Nav */}
        <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
          {navItems.map(n=>(
            <div key={n.page} className={`nav-item${activePage===n.page?' active':''}`} onClick={()=>navigate(n.page)}>
              <span style={{fontSize:18}}>{n.icon}</span>
              <span>{t(navLabelKey[n.page])}</span>
              {n.page==='cases'&&cases.filter(c=>c.status==='PENDING').length>0 && <span style={{marginLeft:'auto',background:'#ef4444',color:'#fff',borderRadius:20,padding:'2px 7px',fontSize:11,fontWeight:700}}>{cases.filter(c=>c.status==='PENDING').length}</span>}
              {n.page==='alerts'&&unreadAlerts>0 && <span style={{marginLeft:'auto',background:'#6366f1',color:'#fff',borderRadius:20,padding:'2px 7px',fontSize:11,fontWeight:700}}>{unreadAlerts}</span>}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{padding:'12px 12px 20px',borderTop:'1px solid #f0f4ff'}}>
          {critical>0 && (
            <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:12,padding:'10px 14px',marginBottom:10,cursor:'pointer',display:'flex',alignItems:'center',gap:8}} onClick={()=>navigate('cases')}>
              <span style={{animation:'pulse 1s infinite',display:'inline-block'}}>🔴</span>
              <span style={{fontSize:12,color:'#dc2626',fontWeight:700}}>{critical} {t('critical_pending')}</span>
            </div>
          )}
          {/* Language toggle */}
          <div style={{display:'flex',background:'#f0f4ff',borderRadius:10,padding:3,marginBottom:8}}>
            {(['en','hi'] as Lang[]).map(l=>(
              <button key={l} onClick={()=>setLang(l)}
                style={{flex:1,padding:'7px 0',border:'none',borderRadius:8,cursor:'pointer',fontFamily:'Plus Jakarta Sans',fontSize:12,fontWeight:700,background:lang===l?'#6366f1':'transparent',color:lang===l?'#fff':'#64748b',transition:'all 0.2s'}}>
                {l==='en'?'EN':'हिंदी'}
              </button>
            ))}
          </div>
          <button onClick={signOut} className="btn-outline" style={{width:'100%',textAlign:'center',fontSize:13}}>{t('nav_signout')}</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{marginLeft:248,flex:1,display:'flex',flexDirection:'column'}}>
        {/* Topbar */}
        <div style={{background:'#fff',borderBottom:'1px solid #e0e7ff',padding:'14px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:50,boxShadow:'0 2px 8px rgba(99,102,241,0.05)'}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:'#1e293b'}}>
              {page==='case_detail'&&detailId?`${t('topbar_case')} #${detailId.slice(-6).toUpperCase()}`:t(navLabelKey[activePage])||'SEVAK'}
            </div>
            <div style={{fontSize:12,color:'#94a3b8',marginTop:1}}>{new Date().toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            {critical>0 && (
              <div style={{display:'flex',alignItems:'center',gap:6,background:'#fef2f2',border:'1px solid #fecaca',padding:'6px 14px',borderRadius:20,cursor:'pointer',fontSize:13,fontWeight:700,color:'#dc2626'}} onClick={()=>navigate('cases')}>
                <span style={{animation:'pulse 1s infinite',display:'inline-block'}}>🔴</span>
                {critical} Critical
              </div>
            )}
            <div style={{position:'relative',cursor:'pointer'}} onClick={()=>navigate('alerts')}>
              <Avatar name={getName(profile)} size={36}/>
              {unreadAlerts>0 && <div style={{position:'absolute',top:-4,right:-4,width:18,height:18,borderRadius:'50%',background:'#ef4444',color:'#fff',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{unreadAlerts>9?'9+':unreadAlerts}</div>}
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{flex:1,overflowY:'auto'}}>
          {page==='dashboard'   && <DashboardPage cases={cases} user={profile} onNavigate={navigate} unreadAlerts={unreadAlerts}/>}
          {page==='report'      && <ReportPage user={profile}/>}
          {page==='cases'       && <CasesPage cases={cases} user={profile} onNavigate={navigate}/>}
          {page==='case_detail' && detailId && <CaseDetailPage caseId={detailId} user={profile} onBack={()=>navigate('cases')}/>}
          {page==='map'         && <MapPage cases={cases}/>}
          {page==='volunteers'  && <VolunteersPage user={profile}/>}
          {page==='alerts'      && <AlertsPage user={profile} onNavigate={navigate}/>}
          {page === 'analytics' && <AnalyticsPage cases={cases} user={profile} />}
          {page === 'profile'   && <ProfilePage user={profile} />}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return <LangProvider><AuthProvider><ToastProvider><AppShell/></ToastProvider></AuthProvider></LangProvider>
}