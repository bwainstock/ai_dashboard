#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * UC8176 (IL0398) monochrome e-paper controller (e.g. Good Display GDEW042M01,
 * 400x300).
 *
 * Buffer: 1 bit per pixel, single plane (bit 0 = black/ink, bit 1 = white/paper,
 * per the base is_on() convention), written un-inverted to NEW RAM (0x13).
 *
 * Full refresh writes OLD (0x10) = 0xFF and uses the OTP waveform. Partial
 * refresh runs a panel-specific "partial init" sequence (power / booster / PLL /
 * VCOM-DC and the register LUTs 0x20-0x24), sets a partial window (0x91/0x90),
 * and drives a differential update from the previous frame (software old_data_).
 *
 * BUSY is active-LOW; the driver flags that itself (busy_invert_).
 */
class EPaperUC8176 : public EPaperBase {
 public:
  EPaperUC8176(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
               size_t init_sequence_length, const uint8_t *partial_sequence, size_t partial_sequence_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_BINARY),
        partial_sequence_(partial_sequence),
        partial_sequence_length_(partial_sequence_length) {
    this->buffer_length_ = this->row_width_ * height;  // single 1-bpp plane
    this->busy_invert_ = true;                         // UC8176 BUSY is active-LOW
  }

 protected:
  void setup() override;
  bool initialise(bool partial) override;
  bool transfer_data() override;
  void power_on() override;
  void refresh_screen(bool partial) override;
  void power_off() override;
  void deep_sleep() override;

  const uint8_t *partial_sequence_;
  size_t partial_sequence_length_;
  uint8_t *old_data_{nullptr};
  bool partial_{false};
};

}  // namespace esphome::epaper_spi
