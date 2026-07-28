// ════════════════════════════════════════════════════
// js/admin-profile.js — โปรไฟล์ผู้ดูแลระบบ (ทุก role)
// ════════════════════════════════════════════════════

const ROLE_TH = {
  super_admin: 'ผู้ดูแลระบบสูงสุด',
  admin:       'ผู้ดูแลระบบ',
};

async function loadAdminProfile() {
  let data;
  try {
    data = await api.get('/admin/profile');
  } catch (e) {
    showToast('โหลดข้อมูลโปรไฟล์ผิดพลาด');
    return;
  }
  const p = data.profile || {};
  document.getElementById('profile-email').value = p.email || '';
  document.getElementById('profile-name').value  = p.full_name || '';
  document.getElementById('profile-role').value  = ROLE_TH[p.role] || p.role || '';

  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value     = '';
  document.getElementById('profile-confirm-password').value = '';
}

// แก้ชื่อ/อีเมลของตัวเองได้ แต่เปลี่ยน role ไม่ได้จากหน้านี้ (profile-role ยัง disabled เสมอ)
async function saveProfileInfo() {
  const email     = document.getElementById('profile-email').value.trim();
  const full_name = document.getElementById('profile-name').value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('กรุณากรอกอีเมลให้ถูกต้อง');
    return;
  }

  let data;
  try {
    data = await api.put('/admin/profile', { email, full_name });
  } catch (e) {
    alert('บันทึกผิดพลาด: ' + (e.message || ''));
    return;
  }

  // อีเมลอาจเปลี่ยน (= JWT identity เปลี่ยน) backend ออก token ใหม่มาให้ ต้องอัปเดต localStorage ทันที
  if (data.token) auth.saveAdmin(data.token, data.profile?.email || email);

  showToast('บันทึกข้อมูลบัญชีสำเร็จ');
  if (typeof currentAdminEmail !== 'undefined') currentAdminEmail = data.profile?.email || email;

  const nameEl   = document.getElementById('adminNameDisplay');
  const avatarEl = document.getElementById('adminAvatar');
  const shownName = data.profile?.full_name || full_name;
  if (nameEl)   nameEl.textContent  = shownName || email;
  if (avatarEl) avatarEl.textContent = (shownName || email || '?').trim().charAt(0);
}

async function saveNewPassword() {
  const current = document.getElementById('profile-current-password').value;
  const next    = document.getElementById('profile-new-password').value;
  const confirm = document.getElementById('profile-confirm-password').value;

  if (!current || !next) {
    alert('กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่');
    return;
  }
  if (next.length < 8) {
    alert('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    return;
  }
  if (next !== confirm) {
    alert('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
    return;
  }

  try {
    await api.put('/admin/change-password', {
      current_password: current,
      new_password:     next,
    });
  } catch (e) {
    alert('เปลี่ยนรหัสผ่านผิดพลาด: ' + (e.message || ''));
    return;
  }
  showToast('เปลี่ยนรหัสผ่านสำเร็จ');
  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value     = '';
  document.getElementById('profile-confirm-password').value = '';
}
