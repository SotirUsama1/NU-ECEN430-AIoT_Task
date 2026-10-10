variable "vpc_count" {
  description = "The number of VPCs to create"
  type        = number
  default     = 1
}

variable "cidr_blocks" {
  description = "A list of CIDR blocks for the VPCs"
  type        = list(string)
  default     = ["10.0.0.0/16"]
}

variable "cidr_base" {
  description = "The base CIDR block for the VPCs"
  type        = string
  default     = "10.0.0.0/8"
}

variable "availability_zones" {
  description = "The number of availability zones to use for the VPC"
  type        = number
  default     = 1
}

variable "public_subnet_count" {
  description = "The number of public subnets to create in the VPC per availability zone"
  type        = number
  default     = 1
}

variable "private_subnet_count" {
  description = "The number of private subnets to create in the VPC per availability zone"
  type        = number
  default     = 1
}

variable "isolated_subnet_count" {
  description = "The number of isolated subnets to create in the VPC per availability zone"
  type        = number
  default     = 0
}

variable "public_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the public subnets"
  type        = list(string)
  default     = []
}

variable "private_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the private subnets"
  type        = list(string)
  default     = []
}

variable "isolated_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the isolated subnets"
  type        = list(string)
  default     = []
}

variable "enable_dns_support" {
  description = "A boolean flag to enable/disable DNS support in the VPC"
  type        = bool
  default     = true
}

variable "enable_dns_hostnames" {
  description = "A boolean flag to enable/disable DNS hostnames in the VPC"
  type        = bool
  default     = true
}

variable "aws_availability_zones" {
  description = "A list of availability zones to use for the VPC"
  type        = list(string)
  default     = []
}

locals {
  cidr_blocks = length(var.cidr_blocks) >= var.vpc_count ? var.cidr_blocks : [
      for i in range(var.vpc_count) : (
        "${cidrsubnet(var.cidr_base, 8, i)}"        )
    ]
    
  subnets_per_az = var.public_subnet_count + var.private_subnet_count + var.isolated_subnet_count

  subnets_cidrs = {
    public = length(var.public_subnet_cidr_blocks) >= var.public_subnet_count * var.availability_zones * var.vpc_count ? var.public_subnet_cidr_blocks : flatten([
      for vpc_idx in range(var.vpc_count) : [
        for az_idx in range(var.availability_zones) : [
          for sub_idx in range(var.public_subnet_count) :
          cidrsubnet(
            local.cidr_blocks[vpc_idx],
            8,
            (az_idx * local.subnets_per_az) + sub_idx
          )
        ]
      ]
    ])
    private = length(var.private_subnet_cidr_blocks) >= var.private_subnet_count * var.availability_zones * var.vpc_count ? var.private_subnet_cidr_blocks : flatten([
      for vpc_idx in range(var.vpc_count) : [
        for az_idx in range(var.availability_zones) : [
          for sub_idx in range(var.private_subnet_count) :
          cidrsubnet(
            local.cidr_blocks[vpc_idx],
            8,
            (az_idx * local.subnets_per_az) + var.public_subnet_count + sub_idx
          )
        ]
      ]
    ])
    isolated = length(var.isolated_subnet_cidr_blocks) >= var.isolated_subnet_count * var.availability_zones * var.vpc_count ? var.isolated_subnet_cidr_blocks : flatten([
      for vpc_idx in range(var.vpc_count) : [
        for az_idx in range(var.availability_zones) : [
          for sub_idx in range(var.isolated_subnet_count) :
          cidrsubnet(
            local.cidr_blocks[vpc_idx],
            8,
            (az_idx * local.subnets_per_az) + var.public_subnet_count + var.private_subnet_count + sub_idx
          )
        ]
      ]
    ])
  }

  vpc_name = var.name == "" ? format("%s-%s", var.context.namespace, var.name_suffix) : var.name
    
  availability_zones = try(slice(var.context.aws_availability_zones, 0, var.availability_zones), var.context.aws_availability_zones, [])
}

variable "tags" {
  description = "A map of tags to assign to the VPC"
  type        = map(string)
  default     = {}
}

variable "context" {
  description = "Global naming and tagging context"
  type        = any
}

variable "name" {
  description = "The name of the VPC"
  type        = string
  default     = ""
}

variable "name_suffix" {
  description = "The suffix to append to the VPC name"
  type        = string
  default     = ""
}