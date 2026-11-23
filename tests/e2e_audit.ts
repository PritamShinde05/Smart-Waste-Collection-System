import assert from 'node:assert/strict';
import { calculateFillPercentage, computeSensorStatus } from '../server/status.ts';
import { db } from '../server/db.ts';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');

async function req(path: string, opts: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function runUnitTests() {
  assert.equal(calculateFillPercentage(100, 100), 0);
  assert.equal(calculateFillPercentage(100, 50), 50);
  assert.equal(calculateFillPercentage(100, 15), 85);
  assert.equal(calculateFillPercentage(100, 0), 100);
  assert.equal(calculateFillPercentage(100, -10), 100);
  assert.equal(calculateFillPercentage(100, 120), 0);

  const now = Date.now();
  const recent = new Date(now - 60_000).toISOString();
  const expired = new Date(now - 1_805_000).toISOString();

  assert.equal(computeSensorStatus(20, recent, 900, 50, 80, now, true), 'NORMAL');
  assert.equal(computeSensorStatus(50, recent, 900, 50, 80, now, true), 'MEDIUM');
  assert.equal(computeSensorStatus(80, recent, 900, 50, 80, now, true), 'FULL');
  assert.equal(computeSensorStatus(80, expired, 900, 50, 80, now, true), 'OFFLINE');
  assert.equal(computeSensorStatus(80, recent, 900, 50, 80, now, false), 'OFFLINE');
  assert.equal(computeSensorStatus(null, recent, 900, 50, 80, now, true), 'OFFLINE');
  console.log('PASS unit tests (fill %, thresholds, 2x interval offline, inactive status)');
}

async function runE2E() {
  const suffix = Date.now();
  const area1Emails: string[] = [];
  let area1Id: number | null = null;
  let area2Id: number | null = null;

  try {
    // 1. Health check
    const health = await req('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');

    // 2. Register Area 1 Admin & Area 2 Admin (for multi-area isolation testing)
    const admin1Email = `qa_admin1_${suffix}@verdantroute.test`;
    const admin1Mobile = `+919800${String(suffix).slice(-6)}`;
    area1Emails.push(admin1Email);

    const reg1 = await req('/api/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'QA Admin One',
        email: admin1Email,
        mobile: admin1Mobile,
        password: 'QaPassword123',
        confirmPassword: 'QaPassword123',
        areaName: `QA Zone 1 ${suffix}`,
        city: 'Pune',
        centreLat: 18.5204,
        centreLng: 73.8567,
      }),
    });
    assert.equal(reg1.status, 201, `reg1 failed: ${JSON.stringify(reg1.json)}`);
    const tokenA1 = reg1.json.token;
    area1Id = reg1.json.user.areaId;

    const reg2 = await req('/api/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'QA Admin Two',
        email: `qa_admin2_${suffix}@verdantroute.test`,
        mobile: `+919700${String(suffix).slice(-6)}`,
        password: 'QaPassword123',
        confirmPassword: 'QaPassword123',
        areaName: `QA Zone 2 ${suffix}`,
        city: 'Mumbai',
        centreLat: 19.076,
        centreLng: 72.8777,
      }),
    });
    assert.equal(reg2.status, 201);
    const tokenA2 = reg2.json.token;
    area2Id = reg2.json.user.areaId;

    // 3. Create Employee in Area 1 + login via Email and Mobile
    const empEmail = `qa_emp1_${suffix}@verdantroute.test`;
    const empMobile = `+919600${String(suffix).slice(-6)}`;
    const empRes = await req(
      '/api/employees',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'QA Driver',
          email: empEmail,
          mobile: empMobile,
          password: 'FieldUser123',
          status: 'ACTIVE',
        }),
      },
      tokenA1
    );
    assert.equal(empRes.status, 201);
    const empId = empRes.json.employee.id;

    // Duplicate email -> 409
    const dupEmp = await req(
      '/api/employees',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Dup',
          email: empEmail,
          mobile: `+919500${String(suffix).slice(-6)}`,
          password: 'FieldUser123',
        }),
      },
      tokenA1
    );
    assert.equal(dupEmp.status, 409);

    // Employee login by email and mobile
    const empLoginEmail = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: empEmail, password: 'FieldUser123' }),
    });
    assert.equal(empLoginEmail.status, 200);

    const empLoginMobile = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: empMobile, password: 'FieldUser123' }),
    });
    assert.equal(empLoginMobile.status, 200);
    const empToken = empLoginMobile.json.token;

    // 4. RBAC enforcement: employee blocked from Admin endpoints -> 403
    const rbacSensors = await req('/api/sensors', {}, empToken);
    assert.equal(rbacSensors.status, 403);
    const rbacAreaPut = await req('/api/area', { method: 'PUT', body: JSON.stringify({ name: 'Hack' }) }, empToken);
    assert.equal(rbacAreaPut.status, 403);

    // 5. Create 3 Sensors in Area 1 + Test WebSocket realtime reception
    const wsAdminEvents: string[] = [];
    const wsEmpEvents: string[] = [];
    const wsAdmin = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(tokenA1)}`);
    const wsEmp = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(empToken)}`);
    await Promise.all([
      new Promise<void>((r) => (wsAdmin.onopen = () => r())),
      new Promise<void>((r) => (wsEmp.onopen = () => r())),
    ]);
    wsAdmin.onmessage = (m) => {
      try {
        wsAdminEvents.push(JSON.parse(String(m.data)).event);
      } catch {}
    };
    wsEmp.onmessage = (m) => {
      try {
        wsEmpEvents.push(JSON.parse(String(m.data)).event);
      } catch {}
    };

    const binsData = [
      { binId: 'QA-BIN-1', label: 'Shivajinagar Gate', latitude: 18.5308, longitude: 73.8475, binHeightCm: 100 },
      { binId: 'QA-BIN-2', label: 'Deccan Corner', latitude: 18.5167, longitude: 73.8415, binHeightCm: 100 },
      { binId: 'QA-BIN-3', label: 'Camp Plaza', latitude: 18.5135, longitude: 73.8794, binHeightCm: 100 },
    ];
    const createdSensors: Array<{ id: number; binId: string; deviceKey: string }> = [];
    for (const b of binsData) {
      const sRes = await req('/api/sensors', { method: 'POST', body: JSON.stringify(b) }, tokenA1);
      assert.equal(sRes.status, 201);
      createdSensors.push({ id: sRes.json.sensor.id, binId: b.binId, deviceKey: sRes.json.deviceKey });
    }

    // 6. Area Isolation: Admin 2 cannot access Area 1 sensor or employees or tasks
    const isoSensor = await req(`/api/sensors/${createdSensors[0].id}`, {}, tokenA2);
    assert.equal(isoSensor.status, 404);
    const isoEmp = await req(`/api/employees/${empId}/history`, {}, tokenA2);
    assert.equal(isoEmp.status, 404);

    // 7. Device ingestion & edge cases
    // 7a. Invalid device key -> 401
    const badKey = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': 'vr_bad_key' },
      body: JSON.stringify({ binId: 'QA-BIN-1', distanceCm: 15 }),
    });
    assert.equal(badKey.status, 401);

    // 7b. Out-of-range distance -> 400
    const negDist = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[0].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-1', distanceCm: -5 }),
    });
    assert.equal(negDist.status, 400);

    const overDist = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[0].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-1', distanceCm: 130 }),
    });
    assert.equal(overDist.status, 400);

    // 7c. Valid full, medium, normal readings
    const rFull = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[0].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-1', distanceCm: 10 }),
    });
    assert.equal(rFull.status, 201);
    assert.equal(rFull.json.fillPercentage, 90);
    assert.equal(rFull.json.status, 'FULL');

    const rMed = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[1].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-2', distanceCm: 40 }),
    });
    assert.equal(rMed.status, 201);
    assert.equal(rMed.json.fillPercentage, 60);
    assert.equal(rMed.json.status, 'MEDIUM');

    const rNorm = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[2].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-3', distanceCm: 80 }),
    });
    assert.equal(rNorm.status, 201);
    assert.equal(rNorm.json.fillPercentage, 20);
    assert.equal(rNorm.json.status, 'NORMAL');

    // 7d. Delayed historical timestamp should NOT overwrite newer reading
    const olderTs = new Date(Date.now() - 3600_000).toISOString();
    const rOlder = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[0].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-1', distanceCm: 95, timestamp: olderTs }),
    });
    assert.equal(rOlder.status, 201);
    const checkBin1 = await req(`/api/sensors/${createdSensors[0].id}`, {}, tokenA1);
    assert.equal(checkBin1.json.sensor.lastFillPercent, 90);

    // 7e. Deactivate bin 3 -> reading rejected 403, status stays OFFLINE even after area threshold change
    await req(`/api/sensors/${createdSensors[2].id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) }, tokenA1);
    const deactRead = await req('/api/device/reading', {
      method: 'POST',
      headers: { 'X-Device-Key': createdSensors[2].deviceKey },
      body: JSON.stringify({ binId: 'QA-BIN-3', distanceCm: 5 }),
    });
    assert.equal(deactRead.status, 403);
    await req('/api/area', { method: 'PUT', body: JSON.stringify({ mediumThreshold: 45, fullThreshold: 75 }) }, tokenA1);
    const bin3Check = await req(`/api/sensors/${createdSensors[2].id}`, {}, tokenA1);
    assert.equal(bin3Check.json.sensor.status, 'OFFLINE');

    // 8. Live OSRM Route Preview & Task Creation -> Accept -> Edit/Reoptimize -> Collect -> Complete
    const preview = await req(
      '/api/routes/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          startType: 'DEPOT',
          employeeId: empId,
          sensorIds: [createdSensors[0].id, createdSensors[1].id],
        }),
      },
      tokenA1
    );
    assert.equal(preview.status, 200, `OSRM preview failed: ${JSON.stringify(preview.json)}`);
    assert.equal(preview.json.routeGeometry.type, 'LineString');
    assert.ok(preview.json.routeGeometry.coordinates.length >= 2);
    assert.ok(preview.json.totalDistanceMeters > 0);

    const taskCreate = await req(
      '/api/tasks',
      {
        method: 'POST',
        body: JSON.stringify({
          employeeId: empId,
          sensorIds: [createdSensors[0].id, createdSensors[1].id],
          startType: 'DEPOT',
          note: 'QA route test',
        }),
      },
      tokenA1
    );
    assert.equal(taskCreate.status, 201);
    const taskId = taskCreate.json.task.id;

    // Area 2 admin cannot view Area 1 task
    const isoTask = await req(`/api/tasks/${taskId}`, {}, tokenA2);
    assert.equal(isoTask.status, 404);

    // Employee accepts task
    const acc = await req(`/api/employee/tasks/${taskId}/accept`, { method: 'PATCH' }, empToken);
    assert.equal(acc.status, 200);
    assert.equal(acc.json.task.status, 'ACCEPTED');

    // Admin adds Bin 3 (reactivated) via Edit Bins & Reoptimize before completion
    await req(`/api/sensors/${createdSensors[2].id}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) }, tokenA1);
    const reopt = await req(
      `/api/tasks/${taskId}/reoptimize`,
      {
        method: 'POST',
        body: JSON.stringify({ sensorIds: createdSensors.map((s) => s.id) }),
      },
      tokenA1
    );
    assert.equal(reopt.status, 200);
    assert.equal(reopt.json.task.stops.length, 3);

    // Employee marks stop 1 collected
    const firstStopId = reopt.json.task.stops[0].taskBinId;
    const collect1 = await req(
      `/api/employee/tasks/${taskId}/bins/${firstStopId}/collect`,
      { method: 'PATCH' },
      empToken
    );
    assert.equal(collect1.status, 200);
    assert.ok(collect1.json.task.stops[0].collectedAt);

    // Employee completes task with note
    const comp = await req(
      `/api/employee/tasks/${taskId}/complete`,
      { method: 'PATCH', body: JSON.stringify({ completionNote: 'All clear' }) },
      empToken
    );
    assert.equal(comp.status, 200);
    assert.equal(comp.json.task.status, 'COMPLETED');
    assert.equal(comp.json.task.completionNote, 'All clear');

    // Verify collected bins reset to 0% NORMAL
    const afterBin1 = await req(`/api/sensors/${createdSensors[0].id}`, {}, tokenA1);
    assert.equal(afterBin1.json.sensor.lastFillPercent, 0);
    assert.equal(afterBin1.json.sensor.status, 'NORMAL');

    // Verify Dashboard summary & Analytics endpoints
    const dashSum = await req('/api/dashboard/summary', {}, tokenA1);
    assert.equal(dashSum.status, 200);
    assert.equal(dashSum.json.cards.totalBins, 3);
    assert.equal(dashSum.json.cards.completedTasks, 1);

    const dashCols = await req('/api/dashboard/collections?days=7', {}, tokenA1);
    assert.equal(dashCols.status, 200);
    assert.ok(dashCols.json.collections.length >= 1);

    // Verify Notifications + mark read
    const notifs = await req('/api/notifications', {}, empToken);
    assert.equal(notifs.status, 200);
    assert.ok(notifs.json.notifications.length >= 2);
    const readOne = await req(`/api/notifications/${notifs.json.notifications[0].id}/read`, { method: 'PATCH' }, empToken);
    assert.equal(readOne.status, 200);

    // Deactivated employee cannot login
    await req(`/api/employees/${empId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE' }) }, tokenA1);
    const blockedEmpLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: empEmail, password: 'FieldUser123' }),
    });
    assert.equal(blockedEmpLogin.status, 403);

    // Verify WebSocket received live events
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(wsAdminEvents.includes('sensor:reading'), `Admin WS missing sensor:reading: ${wsAdminEvents}`);
    assert.ok(wsAdminEvents.includes('task:updated'), `Admin WS missing task:updated: ${wsAdminEvents}`);
    assert.ok(wsEmpEvents.includes('task:assigned'), `Employee WS missing task:assigned: ${wsEmpEvents}`);
    assert.ok(wsEmpEvents.includes('notification:new'), `Employee WS missing notification:new: ${wsEmpEvents}`);

    wsAdmin.close();
    wsEmp.close();

    console.log('PASS full E2E API + RBAC + Area Isolation + OSRM Routing + Device Auth + WebSocket audit');
  } finally {
    // Clean up QA test areas cleanly so preview DB stays pristine
    if (area1Id) db.prepare('DELETE FROM areas WHERE id = ?').run(area1Id);
    if (area2Id) db.prepare('DELETE FROM areas WHERE id = ?').run(area2Id);
  }
}

runUnitTests();
await runE2E();
