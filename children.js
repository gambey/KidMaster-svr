const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 默认家长信件模板（来自 parent-child_love_letter.md），新建孩子时未传 parent_letter 则写入此内容
const DEFAULT_PARENT_LETTER_PATH = path.join(__dirname, '../../parent-child_love_letter.md');
const phoneNumber = `
[childName],很高兴你来到这个家，成为家庭中的一员。
你是爸爸妈妈的心肝宝贝。
你是一个可爱的宝贝，我们很高兴成为你的父母。
很感谢有你的陪伴。
很高兴你是一个[gender]孩子。

你是独一无二，最珍贵的宝贝。
你是健康可爱的乖宝贝，你是爸爸妈妈的心肝宝贝。
你不需要成为什么我们才爱你。
我们爱你，因为你就是你。
你不需要和别人别叫，也不需要比谁好。
我们就爱你这个样子，无论如何，我们就是爱全部的你。
世界上没有任何人可以取代你，我们就是爱你。
你对我们的意义非凡。

我们会照顾你，陪伴你长大时。
我们会尽我们所能让你感到安全和被爱。

你是蒙受恩宠的，你是蒙受祝福的，你是被深爱着的。
你是上天赐给我们最珍贵的宝贝。
你是完美无缺的宝贝。
你是为了教会我们爱，帮助我们的灵魂的进展而来的！
你是为了发挥你独特的天分，展现你的爱与善与美而来的！
在你身边将有很多人陪伴你，协助你，支持你，发挥你独特的天赋和才能！

这个世界因为有你而更完整，更美好。
这个家因为有你而更幸福，更温暖。
我们真的很爱你，我们就是爱你。

宝贝，你真好，我们会爱你一辈子。
宝贝，爸爸妈妈爱你，宝贝感谢有你。
`;
let defaultParentLetter = null;
try {
  defaultParentLetter = fs.readFileSync(DEFAULT_PARENT_LETTER_PATH, 'utf8').trim();
} catch (e) {
  try {
    const cwdPath = path.join(process.cwd(), 'parent-child_love_letter.md');
    defaultParentLetter = fs.readFileSync(cwdPath, 'utf8').trim();
  } catch (e2) {
    defaultParentLetter = phoneNumber;
  }
}

// 将信件内容中的 [childName]、[gender] 替换后返回给客户端
const formatParentLetterForClient = (letter, childName, gender) => {
  if (letter == null || letter === '') return letter;
  const name = childName != null && childName !== '' ? childName : '宝贝';
  const genderText = gender === 1 ? '男' : gender === 2 ? '女' : '宝贝';
  return String(letter)
    .replace(/\[childName\]/g, name)
    .replace(/\[gender\]/g, genderText);
};

// 返回孩子对象，其中 parent_letter 已替换占位符
const withFormattedParentLetter = (child) => {
  if (!child) return child;
  const formatted = { ...child };
  if (formatted.parent_letter != null) {
    formatted.parent_letter = formatParentLetterForClient(
      formatted.parent_letter,
      formatted.child_name,
      formatted.gender
    );
  }
  return formatted;
};

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

  // 处理格式："小学·二年级" 或 "二年级" 或 "初中二年级"
  const parts = gradeStr.split('·');
  const gradeName = parts.length > 1 ? parts[1].trim() : parts[0].trim();

  // 优先匹配更具体的学段关键词（初中、高中）
  if (gradeStr.includes('初中')) {
    // 优先匹配"初二"、"初三"等简短形式
    if (gradeStr.includes('初二') || gradeName.includes('初二')) {
      return { grade_type: 3, grade_code: 'CZ_02', grade_name: '初中二年级' };
    }
    if (gradeStr.includes('初一') || gradeName.includes('初一')) {
      return { grade_type: 3, grade_code: 'CZ_01', grade_name: '初中一年级' };
    }
    if (gradeStr.includes('初三') || gradeName.includes('初三')) {
      return { grade_type: 3, grade_code: 'CZ_03', grade_name: '初中三年级' };
    }
    // 如果没有匹配到简短形式，尝试匹配"一年级"、"二年级"等（在初中范围内）
    if (gradeStr.includes('二年级') || gradeName.includes('二年级')) {
      return { grade_type: 3, grade_code: 'CZ_02', grade_name: '初中二年级' };
    }
    if (gradeStr.includes('一年级') || gradeName.includes('一年级')) {
      return { grade_type: 3, grade_code: 'CZ_01', grade_name: '初中一年级' };
    }
    if (gradeStr.includes('三年级') || gradeName.includes('三年级')) {
      return { grade_type: 3, grade_code: 'CZ_03', grade_name: '初中三年级' };
    }
  }

  if (gradeStr.includes('高中')) {
    // 优先匹配"高一"、"高二"等简短形式
    if (gradeStr.includes('高二') || gradeName.includes('高二')) return { grade_type: 4, grade_code: 'GZ_02', grade_name: '高中二年级' };
    if (gradeStr.includes('高一') || gradeName.includes('高一')) return { grade_type: 4, grade_code: 'GZ_01', grade_name: '高中一年级' };
    if (gradeStr.includes('高三') || gradeName.includes('高三')) return { grade_type: 4, grade_code: 'GZ_03', grade_name: '高中三年级' };
    // 如果没有匹配到简短形式，尝试匹配"一年级"、"二年级"等（在高中范围内）
    if (gradeStr.includes('二年级') || gradeName.includes('二年级')) return { grade_type: 4, grade_code: 'GZ_02', grade_name: '高中二年级' };
    if (gradeStr.includes('一年级') || gradeName.includes('一年级')) return { grade_type: 4, grade_code: 'GZ_01', grade_name: '高中一年级' };
    if (gradeStr.includes('三年级') || gradeName.includes('三年级')) return { grade_type: 4, grade_code: 'GZ_03', grade_name: '高中三年级' };
  }

  if (gradeStr.includes('幼儿园')) {
    if (gradeStr.includes('小班')) return { grade_type: 1, grade_code: 'YK_XB', grade_name: '幼儿园小班' };
    if (gradeStr.includes('中班')) return { grade_type: 1, grade_code: 'YK_ZB', grade_name: '幼儿园中班' };
    if (gradeStr.includes('大班')) return { grade_type: 1, grade_code: 'YK_DB', grade_name: '幼儿园大班' };
  }

  // 匹配年级名称（按长度排序，优先匹配更长的字符串）
  
  // 按key长度降序排序，优先匹配更长的字符串（如"二年级"优先于"年级"）
  const sortedKeys = Object.keys(gradeMap).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
    if (gradeName.includes(key)) {
      return {
        grade_type: gradeMap[key].type,
        grade_code: gradeMap[key].code,
        grade_name: gradeMap[key].name
      };
    }
  }

  // 默认返回null
  return { grade_type: null, grade_code: null, grade_name: gradeStr };
};

// 性别转换：前端"男"/"女" -> 数据库 1/2
const parseGender = (genderStr) => {
  if (genderStr === undefined || genderStr === null) return null;
  if (genderStr === '男' || genderStr === '1' || genderStr === 1) return 1;
  if (genderStr === '女' || genderStr === '2' || genderStr === 2) return 2;
  return null;
};

// 添加小孩信息
router.post('/', authenticate, async (req, res) => {
  const { child_name, gender, age, grade, avatar, remark, relation_type, parent_letter } = req.body || {};

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
      // 确保所有参数都不是 undefined
      const insertParams = [
        child_name,
        genderValue !== null && genderValue !== undefined ? genderValue : null,
        age !== null && age !== undefined ? age : null,
        gradeInfo && gradeInfo.grade_type !== null && gradeInfo.grade_type !== undefined ? gradeInfo.grade_type : null,
        gradeInfo && gradeInfo.grade_code !== null && gradeInfo.grade_code !== undefined ? gradeInfo.grade_code : null,
        gradeInfo && gradeInfo.grade_name !== null && gradeInfo.grade_name !== undefined ? gradeInfo.grade_name : null,
        avatar !== null && avatar !== undefined ? avatar : null,
        remark !== null && remark !== undefined ? remark : null,
        (parent_letter != null && String(parent_letter).trim() !== '') ? parent_letter : (defaultParentLetter || null)
      ];

      const [childResult] = await connection.execute(
        `INSERT INTO child_info 
         (child_name, gender, age, grade_type, grade_code, grade_name, avatar, remark, parent_letter) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        insertParams
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
        data: withFormattedParentLetter(childRows[0])
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
        c.parent_letter,
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
      data: rows.map(withFormattedParentLetter)
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
      data: withFormattedParentLetter(childRows[0])
    });
  } catch (err) {
    console.error('Get child error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 更新小孩信件内容（仅更新 parent_letter）
router.put('/:id/letter', authenticate, async (req, res) => {
  const { id } = req.params;
  const { parent_letter } = req.body || {};

  try {
    const [relationRows] = await db.execute(
      'SELECT * FROM parent_child_relation WHERE parent_id = ? AND child_id = ? AND status = 1 LIMIT 1',
      [req.user.id, id]
    );

    if (!relationRows.length) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    await db.execute(
      'UPDATE child_info SET parent_letter = ? WHERE id = ?',
      [parent_letter != null ? parent_letter : null, id]
    );

    const [childRows] = await db.execute(
      'SELECT * FROM child_info WHERE id = ? LIMIT 1',
      [id]
    );

    return res.json({
      message: 'Letter updated successfully',
      data: withFormattedParentLetter(childRows[0])
    });
  } catch (err) {
    console.error('Update child letter error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 更新小孩信息
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { child_name, gender, age, grade, avatar, remark, parent_letter } = req.body || {};

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
    if (parent_letter !== undefined) {
      updates.push('parent_letter = ?');
      values.push(parent_letter || null);
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
      data: withFormattedParentLetter(childRows[0])
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

