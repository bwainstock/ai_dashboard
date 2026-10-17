#pragma once

#include "esphome/core/color.h"

namespace esphome::epaper_spi {

// Shared black/white/red color mapping for 3-color panels (used by both the
// UC8179 and SSD1683 BWR drivers so the thresholds stay in one place).
enum class BwrState : uint8_t {
  BWR_BLACK,
  BWR_WHITE,
  BWR_RED,
};

inline BwrState color_to_bwr(Color color) {
  if (color.r > color.g + color.b && color.r > 127) {
    return BwrState::BWR_RED;
  }
  if (color.r + color.g + color.b >= 382) {
    return BwrState::BWR_WHITE;
  }
  return BwrState::BWR_BLACK;
}

}  // namespace esphome::epaper_spi
