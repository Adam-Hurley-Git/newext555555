// features/tasks-coloring/index.js

function isTasksChip(el) {
  return !!el && el.nodeType === 1 && el.matches?.('[data-eventid^="tasks."], [data-eventid^="tasks_"]');
}

function getTaskIdFromChip(el) {
  if (!el || !el.getAttribute) return null;

  const ev = el.getAttribute('data-eventid');
  if (ev && (ev.startsWith('tasks.') || ev.startsWith('tasks_'))) {
    return ev.slice(6);
  }

  const taskId = el.getAttribute('data-taskid');
  if (taskId) return taskId;

  let current = el;
  while (current && current !== document.body) {
    const parentEv = current.getAttribute?.('data-eventid');
    if (parentEv && (parentEv.startsWith('tasks.') || parentEv.startsWith('tasks_'))) {
      return parentEv.slice(6);
    }
    const parentTaskId = current.getAttribute?.('data-taskid');
    if (parentTaskId) return parentTaskId;
    current = current.parentNode;
  }

  return null;
}

function getPaintTarget(chip) {
  if (!chip) return null;

  const isInModal = chip.closest('[role="dialog"]');
  if (isInModal) return null;

  const taskButton = chip.querySelector?.('.GTG3wb') || chip.closest?.('.GTG3wb');
  if (taskButton && !taskButton.closest('[role="dialog"]')) {
    return taskButton;
  }

  if (chip.matches('[role="button"]')) {
    return chip;
  }

  const buttonElement = chip.querySelector?.('[role="button"]');
  if (buttonElement) {
    return buttonElement;
  }

  return chip;
}

function getGridRoot() {
  return document.querySelector('[role="grid"]') || document.body;
}

function findTaskElementOnCalendarGrid(taskId) {
  const taskElements = document.querySelectorAll(`[data-eventid="tasks.${taskId}"], [data-eventid="tasks_${taskId}"]`);
  for (const el of taskElements) {
    if (!el.closest('[role="dialog"]')) {
      return el;
    }
  }
  return null;
}

function findTaskButtonsByCharacteristics() {
  const taskButtons = [];
  const potentialTaskSelectors = ['[data-eventid*="task"]', '[data-taskid]', '.GTG3wb'];

  for (const selector of potentialTaskSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (!el.closest('[role="dialog"]') && getTaskIdFromChip(el)) {
        taskButtons.push(el);
      }
    }
  }
  return taskButtons;
}

function findTaskByContent(taskName, taskDate) {
  if (lastClickedTaskId && taskElementReferences.has(lastClickedTaskId)) {
    const storedElement = taskElementReferences.get(lastClickedTaskId);
    if (storedElement && document.contains(storedElement)) {
      return storedElement;
    }
  }

  const calendarTasks = document.querySelectorAll('[data-eventid^="tasks."]');
  for (const task of calendarTasks) {
    const taskText = task.textContent?.toLowerCase() || '';
    if (taskText.includes(taskName.toLowerCase())) {
      return task;
    }
  }

  return null;
}

function resolveTaskIdFromEventTarget(t) {
  let taskId = getTaskIdFromChip(t);
  if (taskId) return taskId;

  const chip = t?.closest?.('[data-eventid^="tasks."]');
  if (chip) {
    taskId = getTaskIdFromChip(chip);
    if (taskId) return taskId;
  }

  let current = t?.parentNode;
  while (current && current !== document.body) {
    taskId = getTaskIdFromChip(current);
    if (taskId) return taskId;
    current = current.parentNode;
  }

  return null;
}

const KEY = 'cf.taskColors';
let taskElementReferences = new Map();

// PERFORMANCE: In-memory cache to avoid constant storage reads
let taskToListMapCache = null;
let listColorsCache = null;
let listTextColorsCache = null;
let completedStylingCache = null;
let manualColorsCache = null;
let cacheLastUpdated = 0;
const CACHE_LIFETIME = 30000; // 30 seconds
let cachedColorMap = null;
let colorMapLastLoaded = 0;
const COLOR_MAP_CACHE_TIME = 1000; // Cache for 1 second

function cleanupStaleReferences() {
  for (const [taskId, element] of taskElementReferences.entries()) {
    if (!element.isConnected) {
      taskElementReferences.delete(taskId);
    }
  }
}

async function loadMap() {
  const now = Date.now();
  if (cachedColorMap && now - colorMapLastLoaded < COLOR_MAP_CACHE_TIME) {
    return cachedColorMap;
  }

  return new Promise((res) =>
    chrome.storage.sync.get(KEY, (o) => {
      cachedColorMap = o[KEY] || {};
      colorMapLastLoaded = now;
      res(cachedColorMap);
    }),
  );
}

async function saveMap(map) {
  return new Promise((res) => chrome.storage.sync.set({ [KEY]: map }, res));
}

async function setTaskColor(taskId, color) {
  const map = await loadMap();
  map[taskId] = color;
  cachedColorMap = map; // Update cache immediately
  colorMapLastLoaded = Date.now(); // Refresh cache timestamp
  await saveMap(map);
  return map;
}

async function clearTaskColor(taskId) {
  const map = await loadMap();
  delete map[taskId];
  cachedColorMap = map; // Update cache immediately
  colorMapLastLoaded = Date.now(); // Refresh cache timestamp
  await saveMap(map);
  return map;
}

async function buildInlineTaskColorRow(initial) {
  const initialColor = initial || '#4285f4';

  // Check if shared utilities are available
  if (!window.cc3SharedUtils?.createCustomColorPicker) {
    console.warn('Custom color picker utilities not available, falling back to HTML5 picker');
    return buildFallbackColorRow(initialColor);
  }

  // Load inline colors from settings
  let inlineColors = null;
  try {
    if (window.cc3Storage) {
      const settings = await window.cc3Storage.getSettings();
      inlineColors = settings?.taskColoring?.inlineColors;
    }
  } catch (error) {
    console.warn('Could not load inline colors from settings:', error);
  }

  let currentColor = initialColor;

  // Create the custom color picker with modal-specific configuration
  const colorPicker = window.cc3SharedUtils.createCustomColorPicker({
    initialColor: currentColor,
    openDirection: 'up', // Open upward in modals
    position: 'modal', // Modal positioning mode
    enableTabs: true,
    inlineColors: inlineColors, // Pass inline colors from settings
    onColorChange: (color) => {
      currentColor = color;
    },
    onApply: () => {
      // This will be handled by the modal Apply button
    },
    onClear: () => {
      // This will be handled by the modal Clear button
    },
  });

  // Create Apply and Clear buttons for the modal UI
  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText = `
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    background: #1a73e8;
    color: white;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    margin-left: 8px;
  `;

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = `
    padding: 6px 16px;
    border: 1px solid #dadce0;
    border-radius: 4px;
    background: #f8f9fa;
    color: #3c4043;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    margin-left: 8px;
  `;

  // Add click event prevention to stop bubbling
  [applyBtn, clearBtn].forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
  });

  // Return API that matches the original interface
  return {
    colorPicker,
    colorInput: {
      get value() {
        return colorPicker.getColor();
      },
      set value(color) {
        colorPicker.setColor(color);
      },
      addEventListener: (event, handler) => {
        if (event === 'change') {
          // Store the handler to call when apply is clicked
          applyBtn._changeHandler = handler;
        }
      },
      dispatchEvent: (event) => {
        if (event.type === 'change' && applyBtn._changeHandler) {
          applyBtn._changeHandler(event);
        }
      },
    },
    applyBtn,
    clearBtn,
    presetContainer: null, // Not needed with custom picker
  };
}

// Fallback to HTML5 color picker if custom picker is not available
async function buildFallbackColorRow(initial) {
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = initial || '#4285f4';
  colorInput.style.cssText = `
    width: 37px;
    height: 37px;
    border: 2px solid #dadce0;
    border-radius: 50%;
    cursor: pointer;
    margin-right: 8px;
    transition: all 0.2s ease;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    padding: 0;
    background: none;
  `;

  // Add hover effect
  colorInput.onmouseover = () => {
    colorInput.style.borderColor = '#1a73e8';
    colorInput.style.transform = 'scale(1.05)';
  };
  colorInput.onmouseout = () => {
    colorInput.style.borderColor = '#dadce0';
    colorInput.style.transform = 'scale(1)';
  };

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText = `
    padding: 4px 8px;
    border: 1px solid #dadce0;
    border-radius: 4px;
    background: #fff;
    color: #3c4043;
    cursor: pointer;
    font-size: 11px;
    margin-right: 6px;
    min-width: 50px;
    height: 24px;
  `;

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = `
    padding: 4px 8px;
    border: 1px solid #dadce0;
    border-radius: 4px;
    background: #f8f9fa;
    color: #3c4043;
    cursor: pointer;
    font-size: 11px;
    min-width: 50px;
    height: 24px;
  `;

  return { colorInput, applyBtn, clearBtn, presetContainer: null };
}

async function paintTaskImmediately(taskId, colorOverride = null, textColorOverride = null) {
  if (!taskId) return;

  const manualOverrideMap = colorOverride ? { [taskId]: colorOverride } : null;

  const combinedSelector = `[data-eventid="tasks.${taskId}"], [data-eventid="tasks_${taskId}"], [data-taskid="${taskId}"]`;
  const allTaskElements = document.querySelectorAll(combinedSelector);

  const manualReferenceMap = manualOverrideMap;

  const modalElement = document.querySelector('[role="dialog"]');

  for (const taskElement of allTaskElements) {
    if (modalElement && modalElement.contains(taskElement)) {
      continue;
    }

    const target = getPaintTarget(taskElement);
    if (!target) {
      continue;
    }

    const isCompleted = isTaskElementCompleted(taskElement);
    const colorInfo = await getColorForTask(taskId, manualReferenceMap, {
      isCompleted,
      overrideTextColor: textColorOverride,
    });

    if (colorInfo) {
      applyPaint(target, colorInfo.backgroundColor, colorInfo.textColor, colorInfo.bgOpacity, colorInfo.textOpacity);

      if (!taskElementReferences.has(taskId)) {
        taskElementReferences.set(taskId, taskElement);
      }
    } else {
      clearPaint(target);
      taskElementReferences.delete(taskId);
    }
  }

  doRepaint(true);
}

async function injectTaskColorControls(dialogEl, taskId, onChanged) {
  if (!dialogEl || !taskId) return;

  // Don't inject for temporary or new task IDs - only for existing tasks
  if (taskId.startsWith('test-task-') || taskId.startsWith('temp-') || taskId.startsWith('new-task-')) {
    // Skip injection for temporary/new task IDs
    return;
  }

  const existingColorPicker = dialogEl.querySelector('.cf-task-color-inline-row');
  if (existingColorPicker) return;

  // Require actual task elements with real task IDs for injection
  const hasExistingTaskElements = dialogEl.querySelector('[data-eventid^="tasks."], [data-taskid]');

  // Only inject if we have evidence this is an existing task modal
  if (!hasExistingTaskElements) {
    // No existing task elements found - appears to be create new event modal, skip injection
    return;
  }

  const map = await loadMap();
  const initialColor = map[taskId] || '#4285f4';
  const { colorPicker, colorInput, applyBtn, clearBtn, presetContainer } = await buildInlineTaskColorRow(initialColor);

  // Immediately show the current task color in the calendar when modal opens
  if (map[taskId]) {
    // Use non-blocking immediate paint for instant modal response
    paintTaskImmediately(taskId, map[taskId]); // Remove await for faster modal opening
  }

  applyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    const selectedColor = colorPicker ? colorPicker.getColor() : colorInput.value;
    await setTaskColor(taskId, selectedColor);
    onChanged?.(taskId, selectedColor);

    await paintTaskImmediately(taskId, selectedColor);

    // Also trigger immediate repaint system for additional coverage
    repaintSoon(true);
  });

  clearBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    await clearTaskColor(taskId);
    onChanged?.(taskId, null);

    // Reset color picker or input to default
    if (colorPicker) {
      colorPicker.setColor('#4285f4');
    } else {
      colorInput.value = '#4285f4';
    }

    // Immediately clear all instances of this task with reliable identification
    await paintTaskImmediately(taskId, null);

    // Also trigger immediate repaint system for additional coverage
    repaintSoon(true);
  });

  const colorRow = document.createElement('div');
  colorRow.className = 'cf-task-color-inline-row';
  colorRow.style.cssText = `
    display: flex !important;
    align-items: center !important;
    padding: 8px 12px !important;
    border: 1px solid #dadce0 !important;
    border-radius: 8px !important;
    background: #ffffff !important;
    margin: 8px 0 !important;
    font-family: 'Google Sans', Roboto, Arial, sans-serif !important;
    font-size: 11px !important;
    min-height: 40px !important;
    width: 100% !important;
    box-sizing: border-box !important;
    flex-wrap: nowrap !important;
    gap: 8px !important;
  `;

  // Add custom color picker or fallback input
  if (colorPicker) {
    colorRow.appendChild(colorPicker.container);
  } else {
    colorRow.appendChild(colorInput);
    if (presetContainer) {
      colorRow.appendChild(presetContainer);
    }
  }

  // Add both Apply and Clear buttons back to the modal
  colorRow.appendChild(applyBtn);
  colorRow.appendChild(clearBtn);

  // Always place within the modal content area, never outside
  const modalContent = dialogEl.querySelector('[role="document"]') || dialogEl;

  // Look for a good insertion point within the modal, prioritizing bottom placement
  const footerArea = modalContent.querySelector('div.HcF6Td');
  if (footerArea) {
    // Insert at the beginning of the footer area to keep it inside
    footerArea.insertBefore(colorRow, footerArea.firstChild);
  } else {
    // Find any container with buttons and insert there
    const allDivs = modalContent.querySelectorAll('div');
    let buttonContainer = null;
    for (const div of allDivs) {
      if (div.querySelector('button')) {
        buttonContainer = div;
        break;
      }
    }

    if (buttonContainer) {
      buttonContainer.appendChild(colorRow);
    } else {
      // Final fallback: create a wrapper div and append to modal content
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'padding: 8px; border-top: 1px solid #dadce0; margin-top: 16px;';
      wrapper.appendChild(colorRow);
      modalContent.appendChild(wrapper);
    }
  }
}

const MARK = 'cf-task-colored';
let repaintQueued = false;
let lastClickedTaskId = null;
let lastRepaintTime = 0;
let repaintCount = 0;

function parseCssColorToRGB(hex) {
  if (!hex) return { r: 66, g: 133, b: 244 }; // fallback G blue
  if (hex.startsWith('rgb')) {
    const match = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      return { r: parseInt(match[1], 10), g: parseInt(match[2], 10), b: parseInt(match[3], 10) };
    }
  }
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function pickContrastingText(hex) {
  const { r, g, b } = parseCssColorToRGB(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function normalizeOpacityValue(value, fallback = 1) {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    if (value > 1) {
      return Math.min(Math.max(value, 0), 100) / 100;
    }
    return Math.min(Math.max(value, 0), 1);
  }
  return fallback;
}

function colorToRgba(color, opacity = 1) {
  const { r, g, b } = parseCssColorToRGB(color);
  const safeOpacity = normalizeOpacityValue(opacity, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeOpacity})`;
}

function isTaskElementCompleted(taskElement) {
  const target = getPaintTarget(taskElement);
  if (!target) return false;

  const textElements = target.querySelectorAll('span, div, p, h1, h2, h3, h4, h5, h6');
  for (const textEl of textElements) {
    const style = window.getComputedStyle(textEl);
    const decoration = style.textDecoration || style.textDecorationLine || '';
    if (decoration && decoration.includes('line-through')) {
      return true;
    }
  }

  return false;
}

function clearPaint(node) {
  if (!node) return;

  node.style.removeProperty('background-color');
  node.style.removeProperty('border-color');
  node.style.removeProperty('color');
  node.style.removeProperty('-webkit-text-fill-color');
  node.style.removeProperty('--cf-task-text-color');
  node.style.removeProperty('mix-blend-mode');
  node.style.removeProperty('filter');
  node.style.removeProperty('opacity');
  delete node.dataset.cfTaskTextColor;
  delete node.dataset.cfTaskBgColor;
  delete node.dataset.cfTaskTextActual;

  node.querySelectorAll?.('span, div, p, h1, h2, h3, h4, h5, h6').forEach((textEl) => {
    textEl.style.removeProperty('color');
    textEl.style.removeProperty('-webkit-text-fill-color');
    textEl.style.removeProperty('mix-blend-mode');
    textEl.style.removeProperty('filter');
    textEl.style.removeProperty('opacity');
    textEl.style.removeProperty('text-decoration-color');
  });

  node.querySelectorAll?.('svg').forEach((svg) => {
    svg.style.removeProperty('color');
    svg.style.removeProperty('fill');
    svg.style.removeProperty('opacity');
  });

  node.classList.remove(MARK);
}

function applyPaint(node, color, textColorOverride = null, bgOpacity = 1, textOpacity = 1) {
  if (!node || !color) return;

  const text = textColorOverride || pickContrastingText(color);
  node.dataset.cfTaskTextColor = textColorOverride ? text.toLowerCase() : '';

  const textColorValue = colorToRgba(text, textOpacity);

  // CRITICAL FIX: Only apply background AND marker class if bgOpacity > 0
  // The cf-task-colored class prevents Google's CSS from applying, so only add it when we have a background
  if (bgOpacity > 0) {
    const bgColorValue = colorToRgba(color, bgOpacity);
    node.classList.add(MARK); // Add class only when we have background
    node.dataset.cfTaskBgColor = bgColorValue;
    node.style.setProperty('background-color', bgColorValue, 'important');
    node.style.setProperty('border-color', bgColorValue, 'important');
    node.style.setProperty('mix-blend-mode', 'normal', 'important');
    node.style.setProperty('filter', 'none', 'important');
    node.style.setProperty('opacity', '1', 'important');
  } else {
    // Remove ALL background-related styling AND the marker class
    // This allows Google's default CSS to apply the background
    node.classList.remove(MARK); // Remove class to let Google's CSS work
    node.style.removeProperty('background-color');
    node.style.removeProperty('border-color');
    node.style.removeProperty('mix-blend-mode');
    node.style.removeProperty('filter');
    node.style.removeProperty('opacity');
    delete node.dataset.cfTaskBgColor;
  }

  // Always apply text color and text styling
  node.dataset.cfTaskTextActual = textColorValue;
  node.style.setProperty('--cf-task-text-color', textColorValue, 'important');
  node.style.setProperty('color', textColorValue, 'important');
  node.style.setProperty('-webkit-text-fill-color', textColorValue, 'important');

  // Only override these properties if we're applying a background color
  // Otherwise they interfere with Google's default background
  if (bgOpacity > 0) {
    node.style.setProperty('mix-blend-mode', 'normal', 'important');
    node.style.setProperty('filter', 'none', 'important');
    node.style.setProperty('opacity', '1', 'important');
  }

  const textElements = node.querySelectorAll('span, div, p, h1, h2, h3, h4, h5, h6');
  for (const textEl of textElements) {
    textEl.style.setProperty('color', textColorValue, 'important');
    textEl.style.setProperty('-webkit-text-fill-color', textColorValue, 'important');
    textEl.style.setProperty('text-decoration-color', textColorValue, 'important');

    // Only override these if applying background color
    if (bgOpacity > 0) {
      textEl.style.setProperty('mix-blend-mode', 'normal', 'important');
      textEl.style.setProperty('filter', 'none', 'important');
      textEl.style.setProperty('opacity', '1', 'important');
    }
  }

  const svgElements = node.querySelectorAll('svg');
  for (const svg of svgElements) {
    svg.style.setProperty('color', textColorValue, 'important');
    svg.style.setProperty('fill', textColorValue, 'important');

    // Only override opacity if applying background color
    if (bgOpacity > 0) {
      svg.style.setProperty('opacity', '1', 'important');
    }
  }
}
function applyPaintIfNeeded(node, colors) {
  if (!node || !colors || !colors.backgroundColor) return;

  const bgOpacity = typeof colors.bgOpacity === 'number' ? colors.bgOpacity : 1;
  const textOpacity = typeof colors.textOpacity === 'number' ? colors.textOpacity : 1;
  const fallbackText = pickContrastingText(colors.backgroundColor);
  const textColor = colors.textColor || fallbackText;
  const desiredBg = colorToRgba(colors.backgroundColor, bgOpacity);
  const desiredText = colorToRgba(textColor, textOpacity);
  const currentBg = node.dataset.cfTaskBgColor;
  const currentText = node.dataset.cfTaskTextActual;

  if (node.classList.contains(MARK) && currentBg === desiredBg && currentText === desiredText) {
    return;
  }

  clearPaint(node);
  applyPaint(node, colors.backgroundColor, colors.textColor, bgOpacity, textOpacity);
}
/**
 * PERFORMANCE: Load all color/mapping data into memory cache
 * Reduces storage reads from ~33/sec to ~1/30sec
 */
async function refreshColorCache() {
  const now = Date.now();

  // Return cached data if still fresh
  if (taskToListMapCache && now - cacheLastUpdated < CACHE_LIFETIME) {
    return {
      taskToListMap: taskToListMapCache,
      listColors: listColorsCache,
      manualColors: manualColorsCache,
      listTextColors: listTextColorsCache,
      completedStyling: completedStylingCache,
    };
  }

  // Fetch all data in parallel
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get('cf.taskToListMap'),
    chrome.storage.sync.get(['cf.taskColors', 'cf.taskListColors', 'cf.taskListTextColors', 'settings']),
  ]);

  // Update cache
  taskToListMapCache = localData['cf.taskToListMap'] || {};
  manualColorsCache = syncData['cf.taskColors'] || {};
  listColorsCache = syncData['cf.taskListColors'] || {};
  const settingsPending =
    syncData.settings?.taskListColoring?.pendingTextColors ||
    syncData.settings?.taskListColoring?.textColors ||
    {};
  listTextColorsCache = {
    ...settingsPending,
    ...(syncData['cf.taskListTextColors'] || {}),
  };
  completedStylingCache = syncData.settings?.taskListColoring?.completedStyling || {};
  cacheLastUpdated = now;

  // DEBUG: Log text colors loaded
  console.log('[Task Colors] Cache refreshed:', {
    textColorsFromStorage: syncData['cf.taskListTextColors'],
    textColorsFromSettings: settingsPending,
    finalTextColorsCache: listTextColorsCache,
    listColors: listColorsCache,
  });

  return {
    taskToListMap: taskToListMapCache,
    listColors: listColorsCache,
    manualColors: manualColorsCache,
    listTextColors: listTextColorsCache,
    completedStyling: completedStylingCache,
  };
}

/**
 * Invalidate cache when storage changes (called by storage listeners)
 */
function invalidateColorCache() {
  cacheLastUpdated = 0;
  taskToListMapCache = null;
  listColorsCache = null;
  listTextColorsCache = null;
  completedStylingCache = null;
  manualColorsCache = null;
}

/**
 * Check if task is in the cache (taskToListMap)
 * OPTIMIZED: Uses in-memory cache instead of storage read
 * @param {string} taskId - Task ID
 * @returns {Promise<boolean>} True if task is in cache
 */
async function isTaskInCache(taskId) {
  const cache = await refreshColorCache();
  return cache.taskToListMap.hasOwnProperty(taskId);
}

/**
 * Get the appropriate color for a task
 * OPTIMIZED: Uses in-memory cache instead of storage reads
 * Priority: manual color > list default color > null
 * @param {string} taskId - Task ID
 * @param {Object} manualColorsMap - Map of manual task colors (DEPRECATED, uses cache now)
 * @returns {Promise<string|null>} Color hex string or null
 */
async function getColorForTask(taskId, manualColorsMap = null, options = {}) {
  const cache = await refreshColorCache();
  const manualColors = manualColorsMap || cache.manualColors;
  const listId = cache.taskToListMap[taskId];
  const isCompleted = options.isCompleted === true;
  const overrideTextColor = options.overrideTextColor;
  const completedStyling = listId ? cache.completedStyling?.[listId] : null;
  const pendingTextColor = listId && cache.listTextColors ? cache.listTextColors[listId] : null;

  // DEBUG: Enhanced logging for completed tasks
  if (isCompleted) {
    console.log(`[Task Colors] DEBUG getColorForTask for completed task:`, {
      taskId,
      inCache: !!cache.taskToListMap[taskId],
      listId,
      hasCompletedStyling: !!completedStyling,
      completedStylingEnabled: completedStyling?.enabled,
      completedBgColor: completedStyling?.bgColor,
      completedTextColor: completedStyling?.textColor,
      listBgColor: listId ? cache.listColors[listId] : null,
      cacheKeys: Object.keys(cache.taskToListMap).length,
    });
  }

  // DEBUG: Log color lookup
  if (listId && cache.listColors[listId]) {
    console.log(`[Task Colors] Getting color for task ${taskId}:`, {
      listId,
      listBgColor: cache.listColors[listId],
      listTextColor: pendingTextColor,
      hasManualColor: !!manualColors?.[taskId],
      textColorsInCache: cache.listTextColors,
    });
  }

  const manualColor = manualColors?.[taskId];
  if (manualColor) {
    // Manual background color: use auto-contrast text (not list text color)
    // unless there's an explicit override
    return buildColorInfo({
      baseColor: manualColor,
      pendingTextColor: null, // Don't use list text color for manual backgrounds
      overrideTextColor,
      isCompleted,
      completedStyling,
    });
  }

  // Check for any list-based settings (background, text, or completed styling)
  if (listId) {
    const listBgColor = cache.listColors[listId];
    const hasTextColor = !!pendingTextColor;
    const hasCompletedStyling = isCompleted && completedStyling?.enabled;

    // Apply colors if we have ANY setting (not just background)
    if (listBgColor || hasTextColor || hasCompletedStyling) {
      const colorInfo = buildColorInfo({
        baseColor: listBgColor, // May be undefined - buildColorInfo will handle it
        pendingTextColor,
        overrideTextColor,
        isCompleted,
        completedStyling,
      });

      // DEBUG: Log final color info
      if (colorInfo) {
        console.log(`[Task Colors] Built color info for task ${taskId}:`, {
          ...colorInfo,
          hadBgColor: !!listBgColor,
          hadTextColor: hasTextColor,
          hadCompletedStyling: hasCompletedStyling,
        });
      }

      return colorInfo;
    }
  }

  // DEBUG: No color found
  if (isCompleted) {
    console.warn(`[Task Colors] No color found for completed task ${taskId}:`, {
      taskInMapping: !!cache.taskToListMap[taskId],
      listId,
      listHasColor: listId ? !!cache.listColors[listId] : false,
    });
  }

  return null;
}

function buildColorInfo({ baseColor, pendingTextColor, overrideTextColor, isCompleted, completedStyling }) {
  // CRITICAL FIX: Allow styling even without base color
  // If we have text colors or completed styling set, we should apply them
  // Use transparent background if no base color is provided

  const hasAnyColorSetting = baseColor || pendingTextColor || overrideTextColor ||
                            (isCompleted && completedStyling?.enabled);

  if (!hasAnyColorSetting) return null;

  // Default to transparent if no background color
  const defaultBgColor = 'rgba(255, 255, 255, 0)';

  if (isCompleted && completedStyling?.enabled) {
    // Completed task styling
    const bgColor = completedStyling.bgColor || baseColor || defaultBgColor;
    const textColor =
      overrideTextColor ||
      completedStyling.textColor ||
      pendingTextColor ||
      (bgColor === defaultBgColor ? '#5f6368' : pickContrastingText(bgColor));

    return {
      backgroundColor: bgColor,
      textColor,
      bgOpacity: normalizeOpacityValue(completedStyling.bgOpacity, completedStyling.bgColor ? 1 : 0),
      textOpacity: normalizeOpacityValue(completedStyling.textOpacity, 1),
    };
  }

  // Pending task styling
  const bgColor = baseColor || defaultBgColor;
  const textColor = overrideTextColor || pendingTextColor ||
                   (bgColor === defaultBgColor ? '#202124' : pickContrastingText(bgColor));

  // DEBUG: Log text color selection
  console.log('[Task Colors] buildColorInfo text color selection:', {
    overrideTextColor,
    pendingTextColor,
    autoContrast: bgColor !== defaultBgColor ? pickContrastingText(bgColor) : 'default',
    selected: textColor,
    hasBgColor: !!baseColor,
  });

  return {
    backgroundColor: bgColor,
    textColor,
    bgOpacity: baseColor ? 1 : 0, // 0 opacity if using default transparent background
    textOpacity: 1,
  };
}

// Retry mechanism for waiting until tasks are actually in the DOM
let repaintRetryCount = 0;
const MAX_REPAINT_RETRIES = 20; // Try up to 20 times
const REPAINT_RETRY_DELAY = 200; // Wait 200ms between retries

// PERFORMANCE: Prevent instant lookup spam
const pendingLookups = new Set();
const lookupDebounceTimers = new Map();
const LOOKUP_DEBOUNCE = 500; // Wait 500ms before triggering API

// Handle new task creation - instant API call for list default color
async function handleNewTaskCreated(taskId, element) {
  // Store reference immediately
  taskElementReferences.set(taskId, element);

  // PERFORMANCE: Debounce rapid lookups (e.g., user creates 5 tasks in 2 seconds)
  if (pendingLookups.has(taskId)) {
    return; // Skip duplicate lookups
  }

  // Mark as pending
  pendingLookups.add(taskId);

  // Clear existing timer for this task
  if (lookupDebounceTimers.has(taskId)) {
    clearTimeout(lookupDebounceTimers.get(taskId));
  }

  // Debounce: wait 500ms before triggering API (in case user creates multiple tasks rapidly)
  lookupDebounceTimers.set(
    taskId,
    setTimeout(async () => {
      lookupDebounceTimers.delete(taskId);

      // Check if list coloring is enabled
      const settings = await window.cc3Storage?.getSettings?.();
      if (!settings?.taskListColoring?.enabled) {
        pendingLookups.delete(taskId);
        return; // Feature disabled
      }

      // Send message to background script for instant API call
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'NEW_TASK_DETECTED',
          taskId: taskId,
        });

        if (response?.success && response.listId) {
          // Invalidate cache so the repaint picks up the new list mapping
          invalidateColorCache();

          // Trigger immediate repaint to apply list default colors
          // (don't use paintTaskImmediately with overrides - that's for manual colors!)
          repaintSoon(true);
        }
      } catch (error) {
        console.error('[Task List Colors] Error applying instant color:', error);
      } finally {
        pendingLookups.delete(taskId);
      }
    }, LOOKUP_DEBOUNCE),
  );
}

async function doRepaint(bypassThrottling = false) {
  const now = Date.now();
  repaintCount++;

  // Check if task coloring features are enabled
  let quickPickColoringEnabled = true;
  let taskListColoringEnabled = false;
  try {
    const settings = await window.cc3Storage?.getSettings?.();
    quickPickColoringEnabled = settings?.taskColoring?.enabled !== false; // Default to true if not set
    taskListColoringEnabled = settings?.taskListColoring?.enabled === true;
  } catch (e) {}

  // Early exit if both quick pick coloring and task list coloring are disabled
  if (!quickPickColoringEnabled && !taskListColoringEnabled) {
    return;
  }

  // Apply throttling only if not bypassing
  if (!bypassThrottling) {
    // Reduced throttling during navigation for faster response
    const minInterval = repaintCount > 5 ? 100 : 25; // Faster for first few repaints
    if (now - lastRepaintTime < minInterval) return;
    if (repaintCount > 15) return; // Allow more repaints during navigation
  }

  lastRepaintTime = now;

  cleanupStaleReferences();
  const manualColorMap = await loadMap();

  // Note: We don't early exit here anymore because we might have:
  // - Text colors set (even without background colors)
  // - Completed styling set (even without pending colors)
  // These should work independently

  const processedTaskIds = new Set();

  // First: Process stored element references (fast path)
  for (const [taskId, element] of taskElementReferences.entries()) {
    if (element.isConnected) {
      const isCompleted = isTaskElementCompleted(element);
      const colors = await getColorForTask(taskId, manualColorMap, { isCompleted });
      if (colors && colors.backgroundColor) {
        const target = getPaintTarget(element);
        if (target) {
          applyPaintIfNeeded(target, colors);
          processedTaskIds.add(taskId);
        }
      }
    }
  }

  // Second: Search for ALL tasks on the page (including new ones after navigation)
  const calendarTasks = document.querySelectorAll('[data-eventid^="tasks."], [data-eventid^="tasks_"], [data-taskid]');

  let skippedModalCount = 0;
  let processedCount = 0;
  let noIdCount = 0;
  let noColorCount = 0;
  let completedCount = 0;
  let completedColoredCount = 0;
  const completedTaskIds = []; // DEBUG: Track completed task IDs

  for (const chip of calendarTasks) {
    // Skip if in modal
    if (chip.closest('[role="dialog"]')) {
      skippedModalCount++;
      continue;
    }

    const id = getTaskIdFromChip(chip);

    if (id) {
      // Check for any color (manual or list default)
      const isCompleted = isTaskElementCompleted(chip);
      if (isCompleted) {
        completedCount++;
        completedTaskIds.push(id); // DEBUG: Track this completed task ID
      }
      const colors = await getColorForTask(id, manualColorMap, { isCompleted });

      // DEBUG: Log completed tasks
      if (isCompleted && colors && colors.backgroundColor) {
        completedColoredCount++;
        console.log('[Task Colors] Coloring completed task:', {
          taskId: id,
          bgColor: colors.backgroundColor,
          textColor: colors.textColor,
          bgOpacity: colors.bgOpacity,
          textOpacity: colors.textOpacity,
        });
      }

      if (colors && colors.backgroundColor) {
        processedCount++;
        // Always process tasks that have colors (manual or list default)
        const target = getPaintTarget(chip);
        if (target) {
          applyPaintIfNeeded(target, colors);
          processedTaskIds.add(id);

          // Store reference for future fast access
          if (!taskElementReferences.has(id)) {
            taskElementReferences.set(id, chip);
          }
        }
      } else {
        // NO COLOR FOUND - Check if this is an unknown task (not in cache)
        // If task is not in cache and list coloring is enabled, trigger instant API lookup
        if (taskListColoringEnabled && !taskElementReferences.has(id)) {
          // Check if task is in the cache before triggering API
          const inCache = await isTaskInCache(id);
          if (!inCache) {
            // Mark as tracked to avoid duplicate lookups
            taskElementReferences.set(id, chip);

            // Trigger instant API call in background (non-blocking)
            handleNewTaskCreated(id, chip);
          } else {
            // Task in cache but no list color assigned - mark as tracked
            taskElementReferences.set(id, chip);
          }
        }
        noColorCount++;
      }
    } else {
      noIdCount++;
    }
  }

  // RETRY MECHANISM: If we found 0 tasks but list coloring is enabled, keep retrying
  // This handles the case where Google Calendar hasn't rendered tasks yet
  if (calendarTasks.length === 0 && taskListColoringEnabled && repaintRetryCount < MAX_REPAINT_RETRIES) {
    repaintRetryCount++;
    setTimeout(() => {
      doRepaint(true); // Retry with bypass throttling
    }, REPAINT_RETRY_DELAY);
    return; // Exit early, retry will handle the rest
  }

  // Reset retry count when tasks are found
  if (calendarTasks.length > 0) {
    repaintRetryCount = 0;
  }

  // Third: Fallback search for any task IDs we haven't found yet
  const unprocessedTaskIds = Object.keys(manualColorMap).filter((id) => !processedTaskIds.has(id));
  if (unprocessedTaskIds.length > 0) {
    // More targeted search - only look for specific task IDs we need
    for (const taskId of unprocessedTaskIds) {
      const taskElements = document.querySelectorAll(
        `[data-eventid="tasks.${taskId}"], [data-eventid="tasks_${taskId}"], [data-taskid="${taskId}"]`,
      );

      for (const element of taskElements) {
        if (!element.closest('[role="dialog"]')) {
          const target = getPaintTarget(element);
          if (target) {
            const isCompleted = isTaskElementCompleted(element);
            const colors = await getColorForTask(taskId, manualColorMap, { isCompleted });
            if (colors && colors.backgroundColor) {
              applyPaintIfNeeded(target, colors);
              taskElementReferences.set(taskId, element);
            }
            break;
          }
        }
      }
    }
  }

  // DEBUG: Log repaint summary
  console.log('[Task Colors] Repaint summary:', {
    totalTasksFound: calendarTasks.length,
    processedCount,
    completedFound: completedCount,
    completedColored: completedColoredCount,
    completedTaskIds, // DEBUG: Show actual task IDs
    noColorCount,
    skippedModalCount,
  });

  // DEBUG: If we found completed tasks but didn't color them, log details
  if (completedCount > 0 && completedColoredCount === 0) {
    const cache = await refreshColorCache();
    const mappingKeys = Object.keys(cache.taskToListMap);
    const sampleMappingKeys = mappingKeys.slice(0, 10);

    console.error('[Task Colors] ⚠️ FOUND COMPLETED TASKS BUT NONE WERE COLORED!', {
      completedTaskIds,
      mappingTotalKeys: mappingKeys.length,
      sampleMappingKeys,
      completedTaskIdsNotInMapping: completedTaskIds.filter(id => !cache.taskToListMap[id])
    });

    // Diagnostic: Try to find if any completed task IDs match with encoding/decoding
    for (const taskId of completedTaskIds.slice(0, 3)) {
      try {
        const decoded = atob(taskId);
        const encoded = btoa(taskId);
        console.log(`[Task Colors] ID format check for ${taskId}:`, {
          original: taskId,
          inMapping: !!cache.taskToListMap[taskId],
          decoded: decoded,
          decodedInMapping: !!cache.taskToListMap[decoded],
          encoded: encoded,
          encodedInMapping: !!cache.taskToListMap[encoded]
        });
      } catch (e) {
        // Ignore encoding errors
      }
    }
  }

  setTimeout(() => {
    repaintCount = 0;
  }, 1000);
}

function repaintSoon(immediate = false) {
  if (repaintQueued && !immediate) return;
  repaintQueued = true;

  if (immediate) {
    // Ultra-fast immediate repaint - no setTimeout, direct execution
    doRepaint(true).then(() => {
      repaintQueued = false;
    });
  } else {
    // Regular frame-based repaint with normal throttling
    requestAnimationFrame(async () => {
      await doRepaint(false);
      repaintQueued = false;
    });
  }
}

function initTasksColoring() {
  // AUTO-SYNC ON PAGE LOAD
  // Trigger incremental sync if last sync > 30 minutes ago
  (async () => {
    try {
      const settings = await window.cc3Storage.getSettings();
      const taskListColoring = settings?.taskListColoring;

      // Only auto-sync if feature is enabled and OAuth granted
      if (taskListColoring?.enabled && taskListColoring?.oauthGranted) {
        const lastSync = taskListColoring.lastSync;
        const now = Date.now();
        const THIRTY_MINUTES = 30 * 60 * 1000;

        // Check if we need to sync
        const shouldSync = !lastSync || (now - lastSync) > THIRTY_MINUTES;

        if (shouldSync) {
          console.log('[Task Colors] Auto-sync triggered on page load (last sync > 30 min)');

          // Trigger incremental sync in background
          chrome.runtime.sendMessage({ type: 'SYNC_TASK_LISTS', fullSync: false }, (response) => {
            if (response?.success) {
              console.log('[Task Colors] Auto-sync complete:', response);
              // Repaint tasks with fresh data
              setTimeout(() => {
                invalidateColorCache();
                repaintSoon();
              }, 500);
            } else {
              console.warn('[Task Colors] Auto-sync failed:', response?.error);
            }
          });
        } else {
          const minutesSinceSync = Math.floor((now - lastSync) / 60000);
          console.log(`[Task Colors] No auto-sync needed (last sync ${minutesSinceSync} minutes ago)`);
        }
      }
    } catch (error) {
      console.error('[Task Colors] Auto-sync check failed:', error);
    }
  })();

  // Listen for storage changes to update modal colors in real-time
  if (window.cc3Storage?.onSettingsChanged) {
    window.cc3Storage.onSettingsChanged((newSettings) => {
      // Refresh any open modal color controls
      const openDialog = document.querySelector('[role="dialog"]');
      if (openDialog && openDialog.querySelector('.cf-task-color-inline-row')) {
        const colorRow = openDialog.querySelector('.cf-task-color-inline-row');
        const taskId = window.cfTasksColoring?.getLastClickedTaskId?.();
        if (colorRow && taskId) {
          // Remove old color row and inject updated one with latest colors
          colorRow.remove();
          setTimeout(async () => {
            try {
              await injectTaskColorControls(openDialog, taskId);
            } catch (e) {
              console.error('Error refreshing modal color controls:', e);
            }
          }, 50);
        }
      }
    });
  }

  document.addEventListener(
    'click',
    (e) => {
      const id = resolveTaskIdFromEventTarget(e.target);
      if (id) {
        lastClickedTaskId = id;
        const taskElement = e.target.closest('[data-eventid^="tasks."]') || e.target;
        if (taskElement && !taskElement.closest('[role="dialog"]')) {
          taskElementReferences.set(id, taskElement);
        } else {
          const calendarTaskElement = findTaskElementOnCalendarGrid(id);
          if (calendarTaskElement) {
            taskElementReferences.set(id, calendarTaskElement);
          }
        }
      }
    },
    true,
  );

  const grid = getGridRoot();
  let mutationTimeout;
  let isNavigating = false;
  let mutationCount = 0;

  const mo = new MutationObserver((mutations) => {
    mutationCount++;

    // Detect navigation vs small updates by mutation count and types
    const hasLargeMutation = mutations.some((m) => m.addedNodes.length > 5);
    const isLikelyNavigation = mutationCount > 3 || hasLargeMutation;

    if (isLikelyNavigation && !isNavigating) {
      // Fast response for navigation - immediate repaint
      isNavigating = true;

      // Clear stored references during navigation for fresh discovery
      taskElementReferences.clear();

      repaintSoon();

      // Additional repaints during navigation to catch late-loading elements
      setTimeout(repaintSoon, 10);
      setTimeout(repaintSoon, 50);
      setTimeout(repaintSoon, 150);

      // Reset navigation flag after mutations settle
      setTimeout(() => {
        isNavigating = false;
        mutationCount = 0;
      }, 500);
    } else if (!isNavigating) {
      // Normal debouncing for minor updates
      clearTimeout(mutationTimeout);
      mutationTimeout = setTimeout(repaintSoon, 50);
    }
  });
  mo.observe(grid, { childList: true, subtree: true });

  // Listen for URL changes (navigation events)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // URL changed - likely navigation, trigger immediate repaint
      repaintSoon();
      setTimeout(repaintSoon, 100);
      setTimeout(repaintSoon, 300);
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  // Also listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', () => {
    repaintSoon();
    setTimeout(repaintSoon, 100);
  });

  // More frequent repaints to ensure colors appear
  setInterval(repaintSoon, 3000);

  // Initial paint immediately and again after a short delay
  repaintSoon();
  setTimeout(repaintSoon, 500);
  setTimeout(repaintSoon, 1500);

  // PERFORMANCE: Listen for storage changes to invalidate cache
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === 'sync' &&
      (changes['cf.taskColors'] || changes['cf.taskListColors'] || changes['cf.taskListTextColors'])
    ) {
      console.log('[Task Colors] Storage changed - sync colors:', {
        taskColors: !!changes['cf.taskColors'],
        taskListColors: !!changes['cf.taskListColors'],
        taskListTextColors: !!changes['cf.taskListTextColors'],
        newTextColors: changes['cf.taskListTextColors']?.newValue,
      });
      invalidateColorCache();
      repaintSoon(); // Repaint with new colors
    }
    if (area === 'sync' && changes.settings) {
      console.log('[Task Colors] Settings changed:', changes.settings?.newValue?.taskListColoring);
      invalidateColorCache();
      repaintSoon();
    }
    if (area === 'local' && changes['cf.taskToListMap']) {
      console.log('[Task Colors] Task-to-list mapping changed');
      invalidateColorCache();
      repaintSoon(); // Repaint with new mappings
    }
  });

  // Listen for runtime messages from background (e.g., after sync)
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'TASK_LISTS_UPDATED') {
      console.log('[Task Colors] Received TASK_LISTS_UPDATED - forcing full repaint');

      // DEBUG: Log current cache state BEFORE clearing
      const { 'cf.taskToListMap': mapping } = await chrome.storage.local.get('cf.taskToListMap');
      console.log('[Task Colors] DEBUG Cache state before repaint:', {
        mappingSize: Object.keys(mapping || {}).length,
        firstFewKeys: Object.keys(mapping || {}).slice(0, 5),
        sampleMapping: mapping,
      });

      // Clear all caches to force fresh data fetch
      invalidateColorCache();
      taskElementReferences.clear();
      // Force multiple aggressive repaints to catch all tasks
      repaintSoon(true); // Immediate
      setTimeout(() => repaintSoon(true), 100);
      setTimeout(() => repaintSoon(true), 500);
      setTimeout(() => repaintSoon(true), 1000);
    }
  });

  window.cfTasksColoring = {
    getLastClickedTaskId: () => lastClickedTaskId,
    repaint: repaintSoon,
    initTasksColoring: initTasksColoring,
    injectTaskColorControls: injectTaskColorControls,
    // Debug functions
    getColorMap: () => loadMap(),
    debugRepaint: () => {
      doRepaint();
    },
  };
}

// Register with feature system for proper settings integration
const taskColoringFeature = {
  id: 'taskColoring',
  init: async function (settings) {
    // Only initialize if enabled
    if (settings && settings.enabled) {
      initTasksColoring();
    } else {
      // Clear any existing task colors
      clearAllTaskColors();
    }
  },
  onSettingsChanged: function (settings) {
    if (settings && settings.enabled) {
      initTasksColoring();
      // Trigger immediate repaint to apply colors
      setTimeout(() => {
        if (window.cfTasksColoring && window.cfTasksColoring.repaint) {
          window.cfTasksColoring.repaint();
        }
      }, 100);
    } else {
      clearAllTaskColors();

      // Also stop any scheduled repaints
      repaintQueued = false;
    }
  },
  teardown: function () {
    clearAllTaskColors();
  },
};

// Function to paint all tasks with default Google blue color (when feature is turned off)
function clearAllTaskColors() {
  const defaultBlue = 'rgb(66, 133, 244)'; // Google Calendar default task color

  // Find all task elements and paint them blue
  const taskElements = document.querySelectorAll('[data-eventid^="tasks."], [data-eventid^="tasks_"], [data-taskid]');

  taskElements.forEach((taskEl) => {
    if (!taskEl.closest('[role="dialog"]')) {
      // Skip modal tasks
      const target = getPaintTarget(taskEl);
      if (target) {
        // Clear any existing custom paint first
        clearPaint(target);
        // Then apply the default blue color
        applyPaint(target, defaultBlue);
      }
    }
  });

  // Clear stored references since we're disabling custom colors
  taskElementReferences.clear();
}

// Register the feature if the registry is available
if (window.cc3Features) {
  window.cc3Features.register(taskColoringFeature);
} else {
  // Fallback: auto-initialize when the module loads if registry not available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTasksColoring);
  } else {
    initTasksColoring();
  }
}