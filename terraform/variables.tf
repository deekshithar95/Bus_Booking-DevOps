variable "aws_region" {
  description = "AWS region for BusBooking resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Resource naming prefix"
  type        = string
  default     = "busbooking"
}

variable "instance_type" {
  description = "EC2 instance type; choose based on account eligibility and workload"
  type        = string
  default     = "t3.small"
}

variable "admin_cidr" {
  description = "Your approved public IP in CIDR notation, e.g. 203.0.113.10/32"
  type        = string
}

variable "key_pair_name" {
  description = "Existing EC2 key pair name for SSH access"
  type        = string
}

variable "root_volume_size" {
  description = "EC2 root volume size in GiB"
  type        = number
  default     = 20
}
