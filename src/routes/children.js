const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 解析年级信息，将前端传来的"小学·二年级"转换为数据库字段
const parseGrade = (gradeStr) => {
  if (!gradeStr) return { grade_type: null, grade_code: null, grade_name: null };

  const gradeMap = {
    // 幼儿园
    '小班': { type: 1, code: 'YK_XB', name: '幼儿园小班' },
    '中班': { type: 1, code: 'YK_ZB', name: '幼儿园中班' },
    '大班': { type: 1, code: 'YK_DB', name: '幼儿园大班' },
    // 小学
    '一年级': { type: 2, code: 'XX_01', name: '小学一年级' },
    '二年级': { type: 2, code: 'XX_02', name: '小学二年级' },
    '三年级': { type: 2, code: 'XX_03', name: '小学三年级' },
    '四年级': { type: 2, code: 'XX_04', name: '小学四年级' },
    '五年级': { type: 2, code: 'XX_05', name: '小学五年级' },
    '六年级': { type: 2, code: 'XX_06', name: '小学六年级' },
    // 初中
    '初一': { type: 3, code: 'CZ_01', name: '初中一年级' },
    '初二': { type: 3, code: 'CZ_02', name: '初中二年级' },
    '初三': { type: 3, code: 'CZ_03', name: '初中三年级' },
    // 高中
    '高一': { type: 4, code: 'GZ_01', name: '高中一年级' },
    '高二': { type: 4, code: 'GZ_02', name: '高中二年级' },
    '高三': { type: 4, code: 'GZ_03', name: '高中三年级' }
  };

  // 处理格式："小学·二年级" 或 "二年级"
  const parts = gradeStr.split('·');
  const gradeName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
  
  // 匹配年级名称
  for (const [key, value] of Object.entries(gradeMap)) {
    if (gradeName.includes(key)) {
      return {
        grade_type: value.type,
        grade_code: value.code,
        grade_name: value.name
      };
    }
  }

  // 如果无法匹配，尝试从字符串中提取
  if (gradeStr.includes('幼儿园')) {
    if (gradeStr.includes('小班')) return { type: 1, code: 'YK_XB', name: '幼儿园小班' };
    if (gradeStr.includes('中班')) return { type: 1, code: 'YK_ZB', name: '幼儿园中班' };
    if (gradeStr.includes('大班')) return { type: 1, code: 'YK_DB', name: '幼儿园大班' };
  }

  // 默认返回null
  return { grade_type: null, grade_code: null, grade_name: gradeStr };
};

// 性别转换：前端"男"/"女" -> 数据库 1/2
const parseGender = (genderStr) => {
  if (!genderStr) return -1;
  if (genderStr === '男' || genderStr === '0' || genderStr === 0) return 0;
  if (genderStr === '女' || genderStr === '1' || genderStr === 1) return 1;
  return 0;
};

// 添加小孩信息
router.post('/', authenticate, async (req, res) => {
  const { child_name, gender, age, grade, avatar, remark, relation_type } = req.body || {};
  
  // 验证必填字段
  if (!child_name) {
    return res.status(400).json({ message: 'child_name is required' });
  } 

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 解析年级信息
      const gradeInfo = parseGrade(grade);
      const genderValue = parseGender(gender);

      // 插入小孩信息
      const [childResult] = await connection.execute(
        `INSERT INTO child_info 
         (child_name, gender, age, grade_type, grade_code, grade_name, avatar, remark) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          child_name,
          genderValue,
          age || null,
          gradeInfo.grade_type,
          gradeInfo.grade_code,
          gradeInfo.grade_name,
          avatar || null,
          remark || null
        ]
      );

      const childId = childResult.insertId;

      // 创建亲子关系（默认relation_type=1父亲，如果前端传了则使用传的值）
      const relationType = relation_type || 1;
      await connection.execute(
        `INSERT INTO parent_child_relation 
         (parent_id, child_id, relation_type, status) 
         VALUES (?, ?, ?, 1)`,
        [req.user.id, childId, relationType]
      );

      await connection.commit();
      connection.release();

      // 返回创建的小孩信息
      const [childRows] = await db.execute(
        'SELECT * FROM child_info WHERE id = ? LIMIT 1',
        [childId]
      );

      return res.status(201).json({
        message: 'Child added successfully',
        data: childRows[0]
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    console.error('Add child error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 获取当前用户的所有小孩列表
router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT 
        c.id,
        c.child_name,
        c.gender,
        c.age,
        c.grade_type,
        c.grade_code,
        c.grade_name,
        c.avatar,
        c.remark,
        c.create_time,
        c.update_time,
        r.relation_type,
        r.status as relation_status
       FROM child_info c
       INNER JOIN parent_child_relation r ON c.id = r.child_id
       WHERE r.parent_id = ? AND r.status = 1
       ORDER BY c.create_time DESC`,
      [req.user.id]
    );

    return res.json({
      message: 'Success',
      data: rows
    });
  } catch (err) {
    console.error('Get children error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 获取单个小孩详情
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  try {
    // 验证该小孩属于当前用户
    const [relationRows] = await db.execute(
      'SELECT * FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
      [req.user.id, id]
    );

    if (!relationRows.length) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    const [childRows] = await db.execute(
      'SELECT * FROM child_info WHERE id = ? LIMIT 1',
      [id]
    );

    if (!childRows.length) {
      return res.status(404).json({ message: 'Child not found' });
    }

    return res.json({
      message: 'Success',
      data: childRows[0]
    });
  } catch (err) {
    console.error('Get child error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 更新小孩信息
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { child_name, gender, age, grade, avatar, remark } = req.body || {};

  try {
    // 验证该小孩属于当前用户
    const [relationRows] = await db.execute(
      'SELECT * FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
      [req.user.id, id]
    );

    if (!relationRows.length) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    // 构建更新字段
    const updates = [];
    const values = [];

    if (child_name !== undefined) {
      updates.push('child_name = ?');
      values.push(child_name);
    }
    if (gender !== undefined) {
      updates.push('gender = ?');
      values.push(parseGender(gender));
    }
    if (age !== undefined) {
      updates.push('age = ?');
      values.push(age || null);
    }
    if (grade !== undefined) {
      const gradeInfo = parseGrade(grade);
      updates.push('grade_type = ?, grade_code = ?, grade_name = ?');
      values.push(gradeInfo.grade_type, gradeInfo.grade_code, gradeInfo.grade_name);
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?');
      values.push(avatar || null);
    }
    if (remark !== undefined) {
      updates.push('remark = ?');
      values.push(remark || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);

    await db.execute(
      `UPDATE child_info SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // 返回更新后的数据
    const [childRows] = await db.execute(
      'SELECT * FROM child_info WHERE id = ? LIMIT 1',
      [id]
    );

    return res.json({
      message: 'Child updated successfully',
      data: childRows[0]
    });
  } catch (err) {
    console.error('Update child error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 删除小孩（软删除：解除关系）
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // 验证该小孩属于当前用户
    const [relationRows] = await db.execute(
      'SELECT * FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
      [req.user.id, id]
    );

    if (!relationRows.length) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    // 软删除：将关系状态设为0
    await db.execute(
      'UPDATE parent_child_relation SET status = 0 WHERE parent_id = ? AND child_id = ?',
      [req.user.id, id]
    );

    return res.json({
      message: 'Child relationship removed successfully'
    });
  } catch (err) {
    console.error('Delete child error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

