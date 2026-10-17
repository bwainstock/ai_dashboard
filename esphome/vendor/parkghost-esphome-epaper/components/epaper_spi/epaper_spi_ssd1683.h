#pragma once

#include "epaper_spi.h"

namespace esphome::epaper_spi {

/**
 * SSD1683 3-color (black/white/red) e-paper controller (e.g. DEPG0420, 400x300).
 *
 * Buffer layout: 1 bit per pixel, two separate planes
 * - first half:  Black/White plane (bit 1 = white, 0 = black) -> RAM 0x24
 * - second half: Red plane         (bit 1 = red,   0 = none)  -> RAM 0x26
 *
 * A single RAM window is set before the transfer; the address counter wraps at
 * the window boundary, so both planes are written back-to-back without a reset.
 *
 * SSD1683 has no differential partial mode: `full_update_every` selects between
 * a full refresh and a faster whole-screen redraw (both re-send the whole frame),
 * so no previous frame is retained between updates.
 *
 * BUSY is active-HIGH, which is this component's default (no inversion).
 */
class EPaperSSD1683 : public EPaperBase {
 public:
  EPaperSSD1683(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
                size_t init_sequence_length)
      : EPaperBase(name, width, height, init_sequence, init_sequence_length, DISPLAY_TYPE_COLOR) {
    this->buffer_length_ = this->row_width_ * height * 2;  // two 1-bpp planes
  }

  void fill(Color color) override;
  // COLOR_ON maps to white here (3-color true color), unlike the mono base.
  void clear() override { this->fill(COLOR_ON); }

 protected:
  void draw_pixel_at(int x, int y, Color color) override;
  bool reset() override;
  bool transfer_data() override;
  void power_on() override {}
  void refresh_screen(bool fast) override;
  void power_off() override;
  void deep_sleep() override;

  void set_ram_area_();
  // 0x22 (display update control) with `mode`, then 0x20 (master activation).
  void send_update_(uint8_t mode);
};

}  // namespace esphome::epaper_spi
