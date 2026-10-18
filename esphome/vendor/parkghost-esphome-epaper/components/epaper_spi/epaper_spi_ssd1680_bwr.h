#pragma once

#include "epaper_spi_ssd1683.h"

namespace esphome::epaper_spi {

/**
 * SSD1680 3-color (black/white/red) e-paper controller (e.g. Good Display
 * GDEY029Z95, 128x296).
 *
 * SSD1680's 3-color command set (0x24/0x26 planes, 0x22/0x20 update, 0xF7 full /
 * 0x1A+0x91+0xC7 fast, 0x10 deep sleep) is identical to SSD1683's, so this reuses
 * the SSD1683 implementation unchanged.
 */
class EPaperSSD1680BWR : public EPaperSSD1683 {
 public:
  using EPaperSSD1683::EPaperSSD1683;
};

}  // namespace esphome::epaper_spi
