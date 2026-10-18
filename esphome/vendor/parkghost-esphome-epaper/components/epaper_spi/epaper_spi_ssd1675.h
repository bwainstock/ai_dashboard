#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * SSD1675A (IL3897) monochrome e-paper controller (e.g. HINK E0213A09, 104x212).
 *
 * Buffer: 1 bit per pixel, single plane (bit 1 = white, 0 = black), written to
 * RAM 0x24. The host loads explicit waveform LUTs (0x32) — panel data supplied
 * by the model. After each refresh the displayed frame is copied into the OLD
 * RAM bank (0x26) so the next differential partial update has a valid reference;
 * a full update is forced every `full_update_every` times to de-ghost.
 *
 * BUSY is active-HIGH, which is this component's default (no inversion).
 */
class EPaperSSD1675 : public EPaperBase {
 public:
  EPaperSSD1675(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                size_t init_sequence_length, const uint8_t *lut_full, size_t lut_full_length,
                const uint8_t *lut_partial, size_t lut_partial_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_BINARY),
        lut_full_(lut_full),
        lut_full_length_(lut_full_length),
        lut_partial_(lut_partial),
        lut_partial_length_(lut_partial_length) {
    this->buffer_length_ = this->row_width_ * height;  // single 1-bpp plane
  }

 protected:
  bool initialise(bool partial) override;
  bool transfer_data() override;
  void power_on() override {}
  void refresh_screen(bool partial) override;
  void power_off() override;
  void deep_sleep() override;

  void set_ram_area_();
  // 0x22 (display update control) with `mode`, then 0x20 (master activation).
  void send_update_(uint8_t mode);

  // Waveform LUTs, supplied by the model (panel-specific).
  const uint8_t *lut_full_;
  size_t lut_full_length_;
  const uint8_t *lut_partial_;
  size_t lut_partial_length_;
};

}  // namespace esphome::epaper_spi
