// ════════════════════════════════════════════════════
// js/admin-manage-admins.js — จัดการผู้ดูแลระบบ (super_admin เท่านั้น)
// ════════════════════════════════════════════════════

let allAdmins = [];

async function loadAdmins() {
  let data;
  try {
    data = await api.get('/admin/admins');
  } catch (e) {
    showToast('โหลดข้อมูลผู้ดูแลระบบผิดพลาด');
    return;
  }
  allAdmins = data.admins || [];
  renderAdminsTable();
}

function renderAdminsTable() {
  const tbody = document.getElementById('admins-tbody');
  if (!tbody) return;

  const myEmail = auth.getAdminEmail();

  tbody.innerHTML = allAdmins.length ? allAdmins.map(a => `
    <tr>
      <td style="text-align:center;">${a.full_name || ''}</td>
      <td style="text-align:center;font-size:12.5px;">${a.email}</td>
      <td style="text-align:center;">
        <select class="adm-form-input" style="font-size:12px;padding:4px 6px;" onchange="changeAdminRole('${a.id}', this.value)" ${a.email === myEmail ? 'disabled' : ''}>
          <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>admin</option>
          <option value="super_admin" ${a.role === 'super_admin' ? 'selected' : ''}>super_admin</option>
        </select>
      </td>
      <td style="text-align:center;">${fmtDateDMY(a.created_at)}</td>
      <td style="text-align:center;">
        <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteAdmin('${a.id}', '${(a.email || '').replace(/'/g, "\\'")}')" ${a.email === myEmail ? 'disabled' : ''}>ลบ</button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
}

function openAdminModal() {
  document.getElementById('admin-ml-email').value    = '';
  document.getElementById('admin-ml-name').value     = '';
  const pwdEl = document.getElementById('admin-ml-password');
  pwdEl.value = '';
  pwdEl.type  = 'password';
  pwdEl.closest('.pwd-field-wrap')?.querySelector('.pwd-toggle-btn')?.classList.remove('showing');
  document.getElementById('admin-ml-role').value      = 'admin';
  document.getElementById('admin-modal').style.display = 'flex';
}

function closeAdminModal() {
  document.getElementById('admin-modal').style.display = 'none';
}

async function saveNewAdmin() {
  const email     = document.getElementById('admin-ml-email').value.trim();
  const full_name = document.getElementById('admin-ml-name').value.trim();
  const password  = document.getElementById('admin-ml-password').value;
  const role      = document.getElementById('admin-ml-role').value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('กรุณากรอกอีเมลให้ถูกต้อง');
    return;
  }
  if (!password || password.length < 8) {
    alert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    return;
  }

  try {
    await api.post('/admin/admins', { email, full_name, password, role });
  } catch (e) {
    alert('บันทึกผิดพลาด: ' + (e.message || ''));
    return;
  }
  showToast('เพิ่มผู้ดูแลระบบสำเร็จ');
  closeAdminModal();
  await loadAdmins();
}

async function changeAdminRole(id, role) {
  try {
    await api.put(`/admin/admins/${id}/role`, { role });
  } catch (e) {
    alert('แก้ไขสิทธิการเข้าถึงระบบผิดพลาด: ' + (e.message || ''));
    await loadAdmins();
    return;
  }
  showToast('แก้ไขสิทธิการเข้าถึงระบบสำเร็จ');
  await loadAdmins();
}

async function deleteAdmin(id, email) {
  if (!confirm(`ลบบัญชีผู้ดูแลระบบ ${email} ?\nไม่สามารถกู้คืนได้`)) return;
  try {
    await api.delete(`/admin/admins/${id}`);
  } catch (e) {
    alert('ลบผิดพลาด: ' + (e.message || ''));
    return;
  }
  showToast('ลบสำเร็จ');
  await loadAdmins();
}
