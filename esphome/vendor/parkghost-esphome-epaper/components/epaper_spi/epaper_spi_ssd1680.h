#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * SSD1680 monochrome e-paper controller (e.g. Good Display GDEM029T94, 128x296).
 *
 * Buffer: 1 bit per pixel, single plane (bit 1 = white, 0 = black), written to
 * RAM 0x24. Full updates use the controller's built-in OTP waveform (0x22=0xF7);
 * partial updates load a host LUT (0x32, panel data from the model) and refresh
 * with 0x22=0xCC. After each refresh the displayed frame is copied into the OLD
 * RAM bank (0x26) so the next differential partial has a valid reference.
 *
 * BUSY is active-HIGH, which is this component's default (no inversion).
 */
class EPaperSSD1680 : public EPaperBase {
 public:
  EPaperSSD1680(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                size_t init_sequence_length, const uint8_t *lut_partial, size_t lut_partial_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_BINARY),
        lut_partial_(lut_partial),
        lut_partial_length_(lut_partial_length) {
    this->buffer_length_ = this->row_width_ * height;  // single 1-bpp plane
  }

 protected:
  bool reset() override;
  bool transfer_data() override;
  void power_on() override {}
  void refresh_screen(bool partial) override;
  void power_off() override;
  void deep_sleep() override;

  void set_ram_area_();
  // 0x22 (display update control) with `mode`, then 0x20 (master activation).
  void send_update_(uint8_t mode);

  // Partial-refresh waveform LUT, supplied by the model (panel-specific).
  // Full refresh uses the controller's built-in OTP LUT instead.
  const uint8_t *lut_partial_;
  size_t lut_partial_length_;
};

}  // namespace esphome::epaper_spi
