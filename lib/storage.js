// cc3 storage utilities (no module syntax to keep content scripts simple)
(function () {
  const DEFAULT_PRESET_COLORS = [
    '#FDE68A',
    '#BFDBFE',
    '#C7D2FE',
    '#FBCFE8',
    '#BBF7D0',
    '#FCA5A5',
    '#A7F3D0',
    '#F5D0FE',
    '#FDE68A',
    '#E9D5FF',
  ];

  const DEFAULT_TASK_PRESET_COLORS = [
    '#4285f4',
    '#34a853',
    '#ea4335',
    '#fbbc04',
    '#ff6d01',
    '#9c27b0',
    '#e91e63',
    '#00bcd4',
    '#8bc34a',
    '#ff9800',
    '#607d8b',
    '#795548',
  ];

  const DEFAULT_TASK_INLINE_COLORS = [
    '#4285f4',
    '#34a853',
    '#ea4335',
    '#fbbc04',
    '#ff6d01',
    '#9c27b0',
    '#e91e63',
    '#00bcd4',
  ];
  const DEFAULT_WEEKDAY_COLORS = {
    0: '#ffd5d5', // Sunday - Light coral/rose
    1: '#e8deff', // Monday - Light lavender
    2: '#d5f5e3', // Tuesday - Light mint
    3: '#ffe8d5', // Wednesday - Light peach
    4: '#d5f0ff', // Thursday - Light sky blue
    5: '#fff5d5', // Friday - Light yellow
    6: '#f0d5ff', // Saturday - Light lilac
  };

  const DEFAULT_WEEKDAY_OPACITY = {
    0: 30, // Sunday
    1: 30, // Monday
    2: 30, // Tuesday
    3: 30, // Wednesday
    4: 30, // Thursday
    5: 30, // Friday
    6: 30, // Saturday
  };

  const defaultSettings = {
    enabled: false,
    weekdayColors: DEFAULT_WEEKDAY_COLORS,
    weekdayOpacity: DEFAULT_WEEKDAY_OPACITY,
    dateColors: {}, // 'YYYY-MM-DD' -> hex color
    presetColors: DEFAULT_PRESET_COLORS,
    weekStart: 0, // 0=Sunday, 1=Monday, 6=Saturday
    taskColoring: {
      enabled: false,
      presetColors: DEFAULT_TASK_PRESET_COLORS,
      inlineColors: DEFAULT_TASK_INLINE_COLORS,
    },
    taskListColoring: {
      enabled: false, // List coloring feature toggle
      oauthGranted: false, // Google OAuth granted
      lastSync: null, // Last sync timestamp
      syncInterval: 5, // Sync interval in minutes
      pendingTextColors: {},
      completedStyling: {},
    },
    timeBlocking: {
      enabled: false,
      globalColor: '#FFEB3B',
      shadingStyle: 'solid', // "solid" or "hashed"
      weeklySchedule: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
      dateSpecificSchedule: {}, // 'YYYY-MM-DD' -> array of timeblocks
    },
  };

  function deepMerge(base, partial) {
    // Replace-keys: when these appear at the current level, we do a hard replace
    const REPLACE_KEYS = new Set(['dateSpecificSchedule', 'weeklySchedule']);

    // If either side isn't a plain object, prefer partial directly
    const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

    if (!isPlainObject(base) || !isPlainObject(partial)) {
      return partial;
    }

    const out = { ...base };

    for (const k in partial) {
      const pv = partial[k];

      // For arrays, always replace
      if (Array.isArray(pv)) {
        out[k] = pv;
        continue;
      }

      // For specific nested maps, hard replace (so removals stick)
      if (REPLACE_KEYS.has(k)) {
        out[k] = isPlainObject(pv) ? { ...pv } : pv;
        continue;
      }

      // Otherwise, recurse for plain objects
      if (isPlainObject(pv)) {
        out[k] = deepMerge(base[k] || {}, pv);
      } else {
        out[k] = pv; // primitives -> replace
      }
    }

    return out;
  }

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ settings: defaultSettings }, (res) => {
        resolve(deepMerge(defaultSettings, res.settings || {}));
      });
    });
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const next = deepMerge(current, partial);
    return new Promise((resolve) => {
      chrome.storage.sync.set({ settings: next }, () => resolve(next));
    });
  }

  function onSettingsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.settings) return;
      const { newValue } = changes.settings;
      // Only call callback if we have a valid newValue, avoid falling back to defaults
      // which could override user choices with default enabled: true
      if (newValue) {
        callback(newValue);
      }
    });
  }

  function ymdFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function setEnabled(enabled) {
    return setSettings({ enabled });
  }
  async function setWeekdayColor(weekdayIndex, color) {
    const key = String(weekdayIndex);
    return setSettings({ weekdayColors: { [key]: color } });
  }
  async function setWeekdayOpacity(weekdayIndex, opacity) {
    const key = String(weekdayIndex);
    return setSettings({ weekdayOpacity: { [key]: opacity } });
  }
  async function setDateColor(dateKey, color) {
    if (!dateKey) return;
    const patch = { dateColors: {} };
    if (color) {
      patch.dateColors[dateKey] = color;
    } else {
      // remove
      const current = await getSettings();
      const next = { ...current.dateColors };
      delete next[dateKey];
      return setSettings({ dateColors: next });
    }
    return setSettings(patch);
  }
  async function clearDateColor(dateKey) {
    return setDateColor(dateKey, null);
  }
  async function addPresetColor(color) {
    const current = await getSettings();
    const set = new Set([...(current.presetColors || []), color]);
    return setSettings({ presetColors: Array.from(set).slice(0, 32) });
  }
  async function setWeekStart(weekStart) {
    return setSettings({ weekStart });
  }

  // Task coloring functions
  async function setTaskColoringEnabled(enabled) {
    return setSettings({ taskColoring: { enabled } });
  }

  async function setTaskPresetColors(colors) {
    return setSettings({ taskColoring: { presetColors: colors } });
  }

  async function addTaskPresetColor(color) {
    const current = await getSettings();
    const currentColors = current.taskColoring?.presetColors || DEFAULT_TASK_PRESET_COLORS;
    const newColors = [...currentColors];
    if (!newColors.includes(color)) {
      newColors.push(color);
      // Limit to 12 colors
      if (newColors.length > 12) {
        newColors.shift();
      }
    }
    return setSettings({ taskColoring: { presetColors: newColors } });
  }

  async function removeTaskPresetColor(index) {
    const current = await getSettings();
    const currentColors = current.taskColoring?.presetColors || DEFAULT_TASK_PRESET_COLORS;
    const newColors = [...currentColors];
    if (index >= 0 && index < newColors.length) {
      newColors.splice(index, 1);
    }
    return setSettings({ taskColoring: { presetColors: newColors } });
  }

  async function updateTaskPresetColor(index, color) {
    const current = await getSettings();
    const currentColors = current.taskColoring?.presetColors || DEFAULT_TASK_PRESET_COLORS;
    const newColors = [...currentColors];
    if (index >= 0 && index < newColors.length) {
      newColors[index] = color;
    }
    return setSettings({ taskColoring: { presetColors: newColors } });
  }

  // Inline colors functions (for the 8 colors shown inline in modal)
  async function setTaskInlineColors(colors) {
    return setSettings({ taskColoring: { inlineColors: colors.slice(0, 8) } });
  }

  async function updateTaskInlineColor(index, color) {
    const current = await getSettings();
    const currentColors = current.taskColoring?.inlineColors || DEFAULT_TASK_INLINE_COLORS;
    const newColors = [...currentColors];
    if (index >= 0 && index < newColors.length) {
      newColors[index] = color;
    }
    return setSettings({ taskColoring: { inlineColors: newColors } });
  }

  // ========================================
  // TASK LIST COLORING FUNCTIONS
  // ========================================

  // Enable/disable task list coloring feature
  async function setTaskListColoringEnabled(enabled) {
    return setSettings({
      taskListColoring: { enabled },
    });
  }

  // Set default color for a task list
  async function setTaskListDefaultColor(listId, color) {
    if (!listId) return;

    return new Promise((resolve) => {
      chrome.storage.sync.get('cf.taskListColors', (result) => {
        const current = result['cf.taskListColors'] || {};
        const updated = { ...current, [listId]: color };

        chrome.storage.sync.set({ 'cf.taskListColors': updated }, () => {
          resolve(updated);
        });
      });
    });
  }

  // Set text color override for a task list
  async function setTaskListTextColor(listId, color) {
    if (!listId || !color) return;

    const settings = await getSettings();
    const current =
      settings.taskListColoring?.pendingTextColors ||
      settings.taskListColoring?.textColors ||
      {};
    const updated = { ...current, [listId]: color };

    console.log('[Storage] Setting task list text color:', { listId, color, updated });

    await chrome.storage.sync.set({ 'cf.taskListTextColors': updated });
    await setSettings({ taskListColoring: { pendingTextColors: updated, textColors: updated } });

    // Verify it was saved
    const verify = await chrome.storage.sync.get('cf.taskListTextColors');
    console.log('[Storage] Verified text colors saved:', verify['cf.taskListTextColors']);

    return updated;
  }

  // Clear default color for a task list
  async function clearTaskListDefaultColor(listId) {
    if (!listId) return;

    return new Promise((resolve) => {
      chrome.storage.sync.get('cf.taskListColors', (result) => {
        const current = result['cf.taskListColors'] || {};
        const updated = { ...current };
        delete updated[listId];

        chrome.storage.sync.set({ 'cf.taskListColors': updated }, () => {
          resolve(updated);
        });
      });
    });
  }

  // Clear text color override for a task list
  async function clearTaskListTextColor(listId) {
    if (!listId) return;

    // CRITICAL: We need to read current settings, delete the key, and save back
    // Cannot use setSettings() because deep merge doesn't delete keys!
    const settings = await getSettings();
    const pendingTextColors = { ...(settings.taskListColoring?.pendingTextColors || {}) };
    const textColors = { ...(settings.taskListColoring?.textColors || {}) };

    // Delete from both locations
    delete pendingTextColors[listId];
    delete textColors[listId];

    // Build the full settings object with the deleted keys
    const updatedSettings = {
      ...settings,
      taskListColoring: {
        ...settings.taskListColoring,
        pendingTextColors,
        textColors,
      },
    };

    // Save directly (not using setSettings to avoid deep merge)
    await chrome.storage.sync.set({
      'cf.taskListTextColors': pendingTextColors,
      'settings': updatedSettings
    });

    return pendingTextColors;
  }

  // Get all list default colors
  async function getTaskListColors() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('cf.taskListColors', (result) => {
        resolve(result['cf.taskListColors'] || {});
      });
    });
  }

  // Get all task list text color overrides
  async function getTaskListTextColors() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['cf.taskListTextColors', 'settings'], (result) => {
        const direct = result['cf.taskListTextColors'] || {};
        const pending =
          result.settings?.taskListColoring?.pendingTextColors ||
          result.settings?.taskListColoring?.textColors ||
          {};
        resolve({ ...pending, ...direct });
      });
    });
  }

  // Get default color for specific task (checks priority: manual > list default > none)
  async function getDefaultColorForTask(taskId) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['cf.taskColors', 'cf.taskListColors'], async (syncResult) => {
        const taskColors = syncResult['cf.taskColors'] || {};

        // Priority 1: Check if task has manual color
        if (taskColors[taskId]) {
          resolve({ type: 'manual', color: taskColors[taskId] });
          return;
        }

        // Priority 2: Check list default
        chrome.storage.local.get('cf.taskToListMap', (localResult) => {
          const mapping = localResult['cf.taskToListMap'] || {};
          const listId = mapping[taskId];

          if (listId) {
            const listColors = syncResult['cf.taskListColors'] || {};
            const color = listColors[listId];

            if (color) {
              resolve({ type: 'list_default', color, listId });
              return;
            }
          }

          // Priority 3: No color
          resolve({ type: 'none', color: null });
        });
      });
    });
  }

  // Get task list metadata
  async function getTaskListsMeta() {
    return new Promise((resolve) => {
      chrome.storage.local.get('cf.taskListsMeta', (result) => {
        resolve(result['cf.taskListsMeta'] || []);
      });
    });
  }

  // Get task to list mapping
  async function getTaskToListMap() {
    return new Promise((resolve) => {
      chrome.storage.local.get('cf.taskToListMap', (result) => {
        resolve(result['cf.taskToListMap'] || {});
      });
    });
  }

  // ========================================
  // COMPLETED TASK STYLING FUNCTIONS
  // ========================================

  /**
   * Enable/disable completed task styling for a specific list
   * @param {string} listId - Task list ID
   * @param {boolean} enabled - Enable completed styling
   * @returns {Promise<Object>} Updated settings
   */
  async function setCompletedStylingEnabled(listId, enabled) {
    if (!listId) return;

    const current = await getSettings();
    const completedStyling = current.taskListColoring?.completedStyling || {};

    const listStyling = completedStyling[listId] || {};
    listStyling.enabled = enabled;

    return setSettings({
      taskListColoring: {
        completedStyling: {
          ...completedStyling,
          [listId]: listStyling,
        },
      },
    });
  }

  /**
   * Set completed task background color for a specific list
   * @param {string} listId - Task list ID
   * @param {string} color - Hex color
   * @returns {Promise<Object>} Updated settings
   */
  async function setCompletedBgColor(listId, color) {
    if (!listId) return;

    const current = await getSettings();
    const completedStyling = current.taskListColoring?.completedStyling || {};

    const listStyling = completedStyling[listId] || {};
    listStyling.bgColor = color;

    return setSettings({
      taskListColoring: {
        completedStyling: {
          ...completedStyling,
          [listId]: listStyling,
        },
      },
    });
  }

  /**
   * Set completed task text color for a specific list
   * @param {string} listId - Task list ID
   * @param {string} color - Hex color
   * @returns {Promise<Object>} Updated settings
   */
  async function setCompletedTextColor(listId, color) {
    if (!listId) return;

    const current = await getSettings();
    const completedStyling = current.taskListColoring?.completedStyling || {};

    const listStyling = completedStyling[listId] || {};
    listStyling.textColor = color;

    return setSettings({
      taskListColoring: {
        completedStyling: {
          ...completedStyling,
          [listId]: listStyling,
        },
      },
    });
  }

  /**
   * Set completed task background opacity for a specific list
   * @param {string} listId - Task list ID
   * @param {number} opacity - Opacity 0-100 or 0-1
   * @returns {Promise<Object>} Updated settings
   */
  async function setCompletedBgOpacity(listId, opacity) {
    if (!listId) return;

    const current = await getSettings();
    const completedStyling = current.taskListColoring?.completedStyling || {};

    const listStyling = completedStyling[listId] || {};
    // Normalize to 0-1 range
    listStyling.bgOpacity = opacity > 1 ? opacity / 100 : opacity;

    return setSettings({
      taskListColoring: {
        completedStyling: {
          ...completedStyling,
          [listId]: listStyling,
        },
      },
    });
  }

  /**
   * Set completed task text opacity for a specific list
   * @param {string} listId - Task list ID
   * @param {number} opacity - Opacity 0-100 or 0-1
   * @returns {Promise<Object>} Updated settings
   */
  async function setCompletedTextOpacity(listId, opacity) {
    if (!listId) return;

    const current = await getSettings();
    const completedStyling = current.taskListColoring?.completedStyling || {};

    const listStyling = completedStyling[listId] || {};
    // Normalize to 0-1 range
    listStyling.textOpacity = opacity > 1 ? opacity / 100 : opacity;

    return setSettings({
      taskListColoring: {
        completedStyling: {
          ...completedStyling,
          [listId]: listStyling,
        },
      },
    });
  }

  /**
   * Clear all completed task styling for a specific list
   * @param {string} listId - Task list ID
   * @returns {Promise<Object>} Updated settings
   */
  async function clearCompletedStyling(listId) {
    if (!listId) return;

    // CRITICAL: Cannot use setSettings() because deep merge doesn't delete keys!
    // We need to manually build the full settings object and save it directly
    const current = await getSettings();
    const completedStyling = { ...(current.taskListColoring?.completedStyling || {}) };
    delete completedStyling[listId];

    // Build the full settings object with the deleted key
    const updatedSettings = {
      ...current,
      taskListColoring: {
        ...current.taskListColoring,
        completedStyling,
      },
    };

    // Save directly to storage (bypasses deep merge)
    await chrome.storage.sync.set({ 'settings': updatedSettings });

    return updatedSettings;
  }

  /**
   * Get completed task styling for a specific list
   * @param {string} listId - Task list ID
   * @returns {Promise<Object|null>} Completed styling config or null
   */
  async function getCompletedStyling(listId) {
    const settings = await getSettings();
    return settings.taskListColoring?.completedStyling?.[listId] || null;
  }

  // Time Blocking functions
  async function setTimeBlockingEnabled(enabled) {
    return setSettings({ timeBlocking: { enabled } });
  }

  async function setTimeBlockingGlobalColor(color) {
    return setSettings({ timeBlocking: { globalColor: color } });
  }

  async function setTimeBlockingShadingStyle(style) {
    return setSettings({ timeBlocking: { shadingStyle: style } });
  }

  async function setTimeBlockingSchedule(schedule) {
    return setSettings({ timeBlocking: { weeklySchedule: schedule } });
  }

  async function addTimeBlock(dayKey, timeBlock) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.weeklySchedule || {};
    const dayBlocks = currentSchedule[dayKey] || [];
    const newBlocks = [...dayBlocks, timeBlock];
    // Sort blocks by start time
    newBlocks.sort((a, b) => {
      const timeToMinutes = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };
      return timeToMinutes(a.timeRange[0]) - timeToMinutes(b.timeRange[0]);
    });
    return setSettings({ timeBlocking: { weeklySchedule: { ...currentSchedule, [dayKey]: newBlocks } } });
  }

  async function removeTimeBlock(dayKey, blockIndex) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.weeklySchedule || {};
    const dayBlocks = currentSchedule[dayKey] || [];
    const newBlocks = dayBlocks.filter((_, index) => index !== blockIndex);
    return setSettings({ timeBlocking: { weeklySchedule: { ...currentSchedule, [dayKey]: newBlocks } } });
  }

  async function updateTimeBlock(dayKey, blockIndex, timeBlock) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.weeklySchedule || {};
    const dayBlocks = currentSchedule[dayKey] || [];
    const newBlocks = [...dayBlocks];
    if (blockIndex >= 0 && blockIndex < newBlocks.length) {
      newBlocks[blockIndex] = timeBlock;
      // Sort blocks by start time
      newBlocks.sort((a, b) => {
        const timeToMinutes = (time) => {
          const [hours, minutes] = time.split(':').map(Number);
          return hours * 60 + minutes;
        };
        return timeToMinutes(a.timeRange[0]) - timeToMinutes(b.timeRange[0]);
      });
    }
    return setSettings({ timeBlocking: { weeklySchedule: { ...currentSchedule, [dayKey]: newBlocks } } });
  }

  // Date-specific timeblock functions
  async function addDateSpecificTimeBlock(dateKey, timeBlock) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.dateSpecificSchedule || {};
    const dateBlocks = currentSchedule[dateKey] || [];
    const newBlocks = [...dateBlocks, timeBlock];
    // Sort blocks by start time
    newBlocks.sort((a, b) => {
      const timeToMinutes = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };
      return timeToMinutes(a.timeRange[0]) - timeToMinutes(b.timeRange[0]);
    });
    return setSettings({ timeBlocking: { dateSpecificSchedule: { ...currentSchedule, [dateKey]: newBlocks } } });
  }

  async function removeDateSpecificTimeBlock(dateKey, blockIndex) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.dateSpecificSchedule || {};
    const dateBlocks = currentSchedule[dateKey] || [];
    const newBlocks = dateBlocks.filter((_, index) => index !== blockIndex);

    // If no blocks left for this date, remove the date key entirely
    if (newBlocks.length === 0) {
      const updatedSchedule = { ...currentSchedule };
      delete updatedSchedule[dateKey];
      return setSettings({ timeBlocking: { dateSpecificSchedule: updatedSchedule } });
    }

    return setSettings({ timeBlocking: { dateSpecificSchedule: { ...currentSchedule, [dateKey]: newBlocks } } });
  }

  async function updateDateSpecificTimeBlock(dateKey, blockIndex, timeBlock) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.dateSpecificSchedule || {};
    const dateBlocks = currentSchedule[dateKey] || [];
    const newBlocks = [...dateBlocks];
    if (blockIndex >= 0 && blockIndex < newBlocks.length) {
      newBlocks[blockIndex] = timeBlock;
      // Sort blocks by start time
      newBlocks.sort((a, b) => {
        const timeToMinutes = (time) => {
          const [hours, minutes] = time.split(':').map(Number);
          return hours * 60 + minutes;
        };
        return timeToMinutes(a.timeRange[0]) - timeToMinutes(b.timeRange[0]);
      });
    }
    return setSettings({ timeBlocking: { dateSpecificSchedule: { ...currentSchedule, [dateKey]: newBlocks } } });
  }

  async function clearDateSpecificBlocks(dateKey) {
    const current = await getSettings();
    const currentSchedule = current.timeBlocking?.dateSpecificSchedule || {};
    const updatedSchedule = { ...currentSchedule };
    delete updatedSchedule[dateKey];
    return setSettings({ timeBlocking: { dateSpecificSchedule: updatedSchedule } });
  }

  // Additional methods for feature registry compatibility
  async function get(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.sync.get([key], (result) => {
        resolve(result[key] || defaultValue);
      });
    });
  }

  async function set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [key]: value }, () => {
        resolve();
      });
    });
  }

  async function getAll() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => {
        resolve(result);
      });
    });
  }

  // Expose globally under cc3Storage
  window.cc3Storage = {
    getSettings,
    setSettings,
    onSettingsChanged,
    setEnabled,
    setWeekdayColor,
    setWeekdayOpacity,
    setDateColor,
    clearDateColor,
    addPresetColor,
    setWeekStart,
    ymdFromDate,
    defaultSettings,
    // Task coloring functions
    setTaskColoringEnabled,
    setTaskPresetColors,
    addTaskPresetColor,
    removeTaskPresetColor,
    updateTaskPresetColor,
    setTaskInlineColors,
    updateTaskInlineColor,
    // Task list coloring functions
    setTaskListColoringEnabled,
    setTaskListDefaultColor,
    setTaskListTextColor,
    clearTaskListDefaultColor,
    clearTaskListTextColor,
    getTaskListColors,
    getTaskListTextColors,
    getDefaultColorForTask,
    getTaskListsMeta,
    getTaskToListMap,
    // Completed task styling functions
    setCompletedStylingEnabled,
    setCompletedBgColor,
    setCompletedTextColor,
    setCompletedBgOpacity,
    setCompletedTextOpacity,
    clearCompletedStyling,
    getCompletedStyling,
    // Time blocking functions
    setTimeBlockingEnabled,
    setTimeBlockingGlobalColor,
    setTimeBlockingShadingStyle,
    setTimeBlockingSchedule,
    addTimeBlock,
    removeTimeBlock,
    updateTimeBlock,
    // Date-specific timeblock functions
    addDateSpecificTimeBlock,
    removeDateSpecificTimeBlock,
    updateDateSpecificTimeBlock,
    clearDateSpecificBlocks,
    // Feature registry compatibility
    get,
    set,
    getAll,
  };
})();
