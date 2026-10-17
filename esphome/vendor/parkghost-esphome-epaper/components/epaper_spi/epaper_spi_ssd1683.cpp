#include "epaper_spi_ssd1683.h"

#include <algorithm>

#include "epaper_spi_bwr_color.h"

namespace esphome::epaper_spi {

void EPaperSSD1683::draw_pixel_at(int x, int y, Color color) {
  if (!this->rotate_coordinates_(x, y))
    return;

  const uint32_t pos = (x / 8) + (y * this->row_width_);
  const uint8_t bit = 0x80 >> (x & 0x07);
  const uint32_t red_offset = this->buffer_length_ / 2u;

  const auto bwr = color_to_bwr(color);

  // Black/White plane: bit 1 = white (SSD1683 0x24 convention)
  if (bwr == BwrState::BWR_WHITE) {
    this->buffer_[pos] |= bit;
  } else {
    this->buffer_[pos] &= ~bit;
  }

  // Red plane: bit 1 = red
  if (bwr == BwrState::BWR_RED) {
    this->buffer_[red_offset + pos] |= bit;
  } else {
    this->buffer_[red_offset + pos] &= ~bit;
  }
}

void EPaperSSD1683::fill(Color color) {
  // Honor active clipping like the base fill(); the base path also sets bounds.
  if (this->get_clipping().is_set()) {
    Display::fill(color);
    return;
  }

  const size_t half_buffer = this->buffer_length_ / 2u;
  const auto bwr = color_to_bwr(color);

  if (bwr == BwrState::BWR_WHITE) {
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[i] = 0xFF;  // B/W plane on (white)
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[half_buffer + i] = 0x00;  // no red
  } else if (bwr == BwrState::BWR_RED) {
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[i] = 0x00;  // no white
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[half_buffer + i] = 0xFF;  // red plane on
  } else {
    this->buffer_.fill(0x00);  // black: no white, no red
  }

  // Mark the whole panel dirty so a fill-only update is not skipped by the FSM.
  this->x_low_ = 0;
  this->y_low_ = 0;
  this->x_high_ = this->width_;
  this->y_high_ = this->height_;
}

void EPaperSSD1683::set_ram_area_() {
  this->cmd_data(0x11, {0x03});  // data entry mode: x+ y+
  this->cmd_data(0x44, {0x00, (uint8_t) ((this->width_ - 1) / 8)});
  this->cmd_data(0x45, {0x00, 0x00, (uint8_t) ((this->height_ - 1) % 256), (uint8_t) ((this->height_ - 1) / 256)});
  this->cmd_data(0x4E, {0x00});
  this->cmd_data(0x4F, {0x00, 0x00});
}

void EPaperSSD1683::send_update_(uint8_t mode) {
  this->cmd_data(0x22, {mode});
  this->command(0x20);
}

bool EPaperSSD1683::reset() {
  if (EPaperBase::reset()) {
    this->command(0x12);  // SWRESET
    return true;
  }
  return false;
}

bool HOT EPaperSSD1683::transfer_data() {
  const uint32_t start_time = millis();
  const size_t half_buffer = this->buffer_length_ / 2u;
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  if (this->current_data_index_ == 0) {
    this->set_ram_area_();
  }

  // Phase 1: Black/White plane -> RAM 0x24
  if (this->current_data_index_ < half_buffer) {
    if (this->current_data_index_ == 0) {
      this->command(0x24);
    }
    this->start_data_();
    while (this->current_data_index_ < half_buffer) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, half_buffer - this->current_data_index_);
      // split_buffer may be non-contiguous: read element-by-element.
      for (size_t k = 0; k < n; k++)
        bytes_to_send[k] = this->buffer_[this->current_data_index_ + k];
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  // Phase 2: Red plane -> RAM 0x26 (counter wrapped back to window start)
  if (this->current_data_index_ < this->buffer_length_) {
    if (this->current_data_index_ == half_buffer) {
      this->command(0x26);
    }
    this->start_data_();
    while (this->current_data_index_ < this->buffer_length_) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, this->buffer_length_ - this->current_data_index_);
      // split_buffer may be non-contiguous: read element-by-element.
      for (size_t k = 0; k < n; k++)
        bytes_to_send[k] = this->buffer_[this->current_data_index_ + k];
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  this->current_data_index_ = 0;
  return true;
}

void EPaperSSD1683::refresh_screen(bool fast) {
  // Non-full updates use a fast full-screen redraw (SSD1683 has no differential
  // partial mode); the whole framebuffer is re-sent each time, so this only
  // selects a faster waveform via the temperature register.
  if (fast) {
    this->cmd_data(0x1A, {0x5A, 0x00});  // write to temperature register
    this->send_update_(0x91);            // load LUT for temperature value
    delay(2);                            // brief settle, < 1ms measured
    this->send_update_(0xC7);            // display update
  } else {
    this->send_update_(0xF7);  // load LUT + display update
  }
}

void EPaperSSD1683::power_off() { this->send_update_(0xC3); }

void EPaperSSD1683::deep_sleep() {
  // The non-full path is a fast full-screen redraw (not a differential partial),
  // so no previous frame needs to survive between updates — always deep sleep to
  // protect the panel.
  this->cmd_data(0x10, {0x11});  // deep sleep
}

}  // namespace esphome::epaper_spi
