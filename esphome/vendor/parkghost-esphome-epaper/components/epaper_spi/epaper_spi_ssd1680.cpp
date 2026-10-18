#include "epaper_spi_ssd1680.h"

#include <algorithm>

namespace esphome::epaper_spi {

void EPaperSSD1680::set_ram_area_() {
  this->cmd_data(0x11, {0x03});  // data entry mode: x+ y+
  this->cmd_data(0x44, {0x00, (uint8_t) ((this->width_ - 1) / 8)});
  this->cmd_data(0x45, {0x00, 0x00, (uint8_t) ((this->height_ - 1) % 256), (uint8_t) ((this->height_ - 1) / 256)});
  this->cmd_data(0x4E, {0x00});
  this->cmd_data(0x4F, {0x00, 0x00});
}

void EPaperSSD1680::send_update_(uint8_t mode) {
  this->cmd_data(0x22, {mode});
  this->command(0x20);
}

bool EPaperSSD1680::reset() {
  if (EPaperBase::reset()) {
    this->command(0x12);  // SWRESET
    return true;
  }
  return false;
}

bool HOT EPaperSSD1680::transfer_data() {
  const uint32_t start_time = millis();
  const size_t frame = this->buffer_length_;
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  if (this->current_data_index_ == 0) {
    this->set_ram_area_();
    this->command(0x24);  // write B/W RAM
  }
  this->start_data_();
  while (this->current_data_index_ < frame) {
    const size_t n = std::min(MAX_TRANSFER_SIZE, frame - this->current_data_index_);
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
  this->current_data_index_ = 0;
  return true;
}

void EPaperSSD1680::refresh_screen(bool partial) {
  if (partial) {
    this->cmd_data(0x32, this->lut_partial_, this->lut_partial_length_);  // host LUT
    this->send_update_(0xCC);
  } else {
    this->send_update_(0xF7);  // built-in OTP LUT + temperature + display
  }
}

void EPaperSSD1680::power_off() {
  // Copy the just-displayed frame into the OLD RAM bank (0x26) so the next
  // differential partial update has a valid reference. Only needed when partial
  // updates are enabled.
  if (this->is_using_partial_update_()) {
    this->set_ram_area_();
    this->command(0x26);
    this->start_data_();
    uint8_t bytes_to_send[MAX_TRANSFER_SIZE];
    size_t i = 0;
    while (i < this->buffer_length_) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, this->buffer_length_ - i);
      // split_buffer may be non-contiguous: read element-by-element.
      for (size_t k = 0; k < n; k++)
        bytes_to_send[k] = this->buffer_[i + k];
      this->write_array(bytes_to_send, n);
      i += n;
    }
    this->disable();
  }

  this->send_update_(0x83);  // power off
}

void EPaperSSD1680::deep_sleep() {
  this->cmd_data(0x10, {0x01});  // enter deep sleep
}

}  // namespace esphome::epaper_spi
