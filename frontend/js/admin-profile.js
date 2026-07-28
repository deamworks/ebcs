// ════════════════════════════════════════════════════
// js/admin-profile.js — โปรไฟล์ผู้ดูแลระบบ (ทุก role)
// ════════════════════════════════════════════════════

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
  document.getElementById('profile-role').value  = p.role || '';

  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value     = '';
  document.getElementById('profile-confirm-password').value = '';
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
