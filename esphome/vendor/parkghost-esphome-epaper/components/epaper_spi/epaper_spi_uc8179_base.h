#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * Common behaviour for UC8179-based panels: the power/refresh/sleep command set
 * and the active-LOW BUSY polarity. Concrete panels (mono, BWR) add fill/draw
 * and transfer_data.
 *
 * Power-on (POWER SETTING + booster + 0x04) is issued in the POWER_ON state
 * after the framebuffer transfer, so the state-machine busy wait covers the
 * power-on delay before REFRESH_SCREEN (0x12).
 */
class EPaperUC8179Base : public EPaperBase {
 public:
  EPaperUC8179Base(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                   size_t init_sequence_length, DisplayType display_type = DISPLAY_TYPE_BINARY)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, display_type) {
    this->busy_invert_ = true;  // UC8179 BUSY is active-LOW
  }

 protected:
  void power_on() override {
    this->cmd_data(0x01, {0x07, 0x07, 0x3F, 0x3F});  // POWER SETTING: VGH/VGL 20V, VDH/VDL 15V
    this->cmd_data(0x06, {0x17, 0x17, 0x28, 0x17});  // Booster Soft Start
    this->command(0x04);                             // POWER ON
  }
  void refresh_screen(bool /*partial*/) override { this->command(0x12); }  // DISPLAY REFRESH
  void power_off() override {
    // Border floating (VBDF) before POWER OFF, per the vendor demo's EPD_DeepSleep:
    // leaving the border driven during deep sleep greys the bezel over time.
    this->cmd_data(0x50, {0xF7});
    this->command(0x02);  // POWER OFF
  }
  void deep_sleep() override { this->cmd_data(0x07, {0xA5}); }  // DEEP SLEEP + check code
};

}  // namespace esphome::epaper_spi
