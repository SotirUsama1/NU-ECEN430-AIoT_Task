variable "aws_region" {
  description = "The AWS region to create resources in"
  type        = string
  default     = "eu-west-3" # Paris
}

variable "aws_profile" {
  description = "The AWS profile to use for authentication"
  type        = string
  default     = "default"
}

variable "dashboard_iam_identity" {
  description = "Optional existing IAM identity used by the dashboard's AWS profile; set type to role or user and provide its name to attach the generated dashboard policy."
  type = object({
    type = string
    name = string
  })
  default = {
    type = ""
    name = ""
  }

  validation {
    condition = contains(["", "role", "user"], var.dashboard_iam_identity.type) && (
      (var.dashboard_iam_identity.type == "" && trimspace(var.dashboard_iam_identity.name) == "") ||
      (var.dashboard_iam_identity.type != "" && trimspace(var.dashboard_iam_identity.name) != "")
    )
    error_message = "Set both dashboard_iam_identity.type (role or user) and dashboard_iam_identity.name, or leave both empty."
  }
}

variable "dashboard_ssh_key_path" {
  description = "Path to the SSH private key on the machine running the dashboard; the key contents remain local."
  type        = string
  default     = "~/.ssh/DEPI-test-key-paris.pem"
}

locals {
  aws_account_id         = data.aws_caller_identity.current.account_id
  aws_availability_zones = data.aws_availability_zones.available.names
}

#########################
### Context Variables ###
#########################

variable "owner_name" {
  description = "The name of the owner"
  type        = string
  default     = "sotir"
}

variable "org_name" {
  description = "The name of the organization"
  type        = string
  default     = "org"
}

variable "project_name" {
  description = "The name of the project"
  type        = string
  default     = "project"
}

variable "env_name" {
  description = "The name of the environment"
  type        = string
  default     = "test"
}

variable "namespace" {
  description = "The namespace for the resources"
  type        = string
  default     = ""
}

locals {
  context = {
    aws_account_id         = local.aws_account_id
    aws_availability_zones = local.aws_availability_zones
    owner                  = var.owner_name
    org                    = var.org_name
    project                = var.project_name
    env                    = var.env_name
    namespace              = var.namespace == "" ? format("%s-%s-%s", var.org_name, var.project_name, var.env_name) : var.namespace
  }
}


##########################
### Resource Variables ###
##########################

variable "vpc_count" {
  description = "The number of VPCs to create"
  type        = number
  default     = 1
}

variable "vpc_name" {
  description = "The name of the VPC"
  type        = string
  default     = ""
}

variable "vpc_name_suffix" {
  description = "The suffix to append to the VPC name"
  type        = string
  default     = "vpc"
}

variable "vpc_cidr_blocks" {
  description = "A list of CIDR blocks for the VPCs"
  type        = list(string)
  default     = []
}

variable "vpc_cidr_base" {
  description = "The base CIDR block for the VPCs"
  type        = string
  default     = "10.0.0.0/8"
}

variable "vpc_az_count" {
  description = "The number of availability zones to use for the VPC"
  type        = number
  default     = 1
}

variable "vpc_public_subnet_count" {
  description = "The number of public subnets to create in the VPC per availability zone"
  type        = number
  default     = 1
}

variable "vpc_private_subnet_count" {
  description = "The number of private subnets to create in the VPC per availability zone"
  type        = number
  default     = 1
}

variable "vpc_isolated_subnet_count" {
  description = "The number of isolated subnets to create in the VPC per availability zone"
  type        = number
  default     = 0
}

variable "vpc_public_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the public subnets"
  type        = list(string)
  default     = []
}

variable "vpc_private_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the private subnets"
  type        = list(string)
  default     = []
}

variable "vpc_isolated_subnet_cidr_blocks" {
  description = "A list of CIDR blocks for the isolated subnets"
  type        = list(string)
  default     = []
}

variable "vpc_enable_nat_gateway" {
  description = "Whether to enable NAT gateways in the VPC"
  type        = bool
  default     = false
}

variable "vpc_nat_gateway_per_az" {
  description = "Whether to create a NAT gateway in each availability zone: true = one NAT gateway per AZ, false = one NAT gateway for the entire VPC"
  type        = bool
  default     = false
}

variable "vpc_nat_cross_az_route" {
  description = "Whether to create cross-AZ routes for NAT gateways: true = create cross-AZ routes (Costier), false = do not create cross-AZ routes"
  type        = bool
  default     = false
}

variable "vpc_enable_dns_support" {
  description = "Whether to enable DNS support for the VPC"
  type        = bool
  default     = true
}

variable "vpc_enable_dns_hostnames" {
  description = "Whether to enable DNS hostnames for the VPC"
  type        = bool
  default     = true
}

variable "vpc_tags" {
  description = "A map of tags to assign to the VPC"
  type        = map(string)
  default     = {}
}

# ### S3 Variables 
# # {

# variable "s3_bucket_name" {
#   description = "The name of the S3 bucket"
#   type        = string
#   default     = ""
# }

# variable "s3_bucket_name_suffix" {
#   description = "The suffix to append to the S3 bucket name"
#   type        = string
#   default     = "bucket"
# }

# variable "s3_bucket_tags" {
#   description = "A map of tags to assign to the S3 bucket"
#   type        = map(string)
#   default     = {}
# }

# variable "s3_force_destroy" {
#   description = "Whether to force destroy the S3 bucket"
#   type        = bool
#   default     = false
# }

# variable "s3_versioning" {
#   description = "Whether to enable versioning for the S3 bucket"
#   type        = bool
#   default     = false
# }

# variable "s3_versioning_configuration" {
#   description = "The versioning configuration for the S3 bucket"
#   type        = map(string)
#   default     = {}
# }

# # }
